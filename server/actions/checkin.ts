"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { emit } from "@/lib/realtime/emit";
import { requireStaff } from "@/lib/auth/session";
import { isCategoryCode } from "@/lib/categories";
import { normalizeSearch } from "@/lib/format";
import { toId } from "@/lib/validate";
import { searchTeams, type SearchHit } from "@/server/queries/competition";

export type CheckInResult =
  | { ok: true; teamId: number; number: string; name: string }
  | { ok: false; error: string };

/** Qidiruv — Server Action orqali, alohida API kerak emas. */
export async function searchTeamsAction(query: string): Promise<SearchHit[]> {
  await requireStaff();
  return searchTeams(query);
}

/**
 * «Keldi» — raqam beriladi.
 *
 * Raqam bazadagi `allocate_team_number` funksiyasi ichida, `FOR UPDATE`
 * qulfi ostida beriladi. Ikki stol ayni soniyada bossa ham R12 ikki marta
 * chiqmaydi. Funksiya idempotent: ikki marta bosilsa o'sha raqamni qaytaradi.
 */
export async function checkInTeam(rawTeamId: unknown): Promise<CheckInResult> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Notoʻgʻri jamoa" };

  try {
    const [team] = await db
      .select({
        name: schema.teams.name,
        number: schema.teams.number,
        categoryCode: schema.teams.categoryCode,
      })
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId));

    if (!team) return { ok: false, error: "Jamoa topilmadi" };

    // Raqam avtomatik BERILMAYDI — u chop etilgan yorliqdan keladi.
    // Bu qadam faqat «keldi» deb belgilaydi, keyin yorliq biriktiriladi.
    return { ok: true, teamId, number: team.number ?? "", name: team.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   «Roʻyxatda yoʻq» — joyida qoʻshish
   ============================================================ */

/**
 * Roʻyxatdan oʻtkazish stolida faqat ikki narsa soʻraladi:
 * yoʻnalish va ishtirokchilar. Jamoa nomi ixtiyoriy — koʻp jamoada
 * nom umuman boʻlmaydi, stolda esa har bir ortiqcha maydon navbatni
 * uzaytiradi.
 */
const walkInSchema = z.object({
  categoryCode: z.string().refine(isCategoryCode, "Yoʻnalish tanlanmagan"),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  members: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Nom boʻsh boʻlsa nima koʻrsatiladi.
 *
 * Tabloda, hakam panelida va juftliklarda jamoa qandaydir nom bilan
 * koʻrinishi kerak. Eng tushunarlisi — birinchi ishtirokchi ismi;
 * u ham boʻlmasa raqamning oʻzi (`R12`).
 */
function resolveTeamName(name: string | undefined, members: string[]): string | null {
  const trimmed = (name ?? "").trim();
  if (trimmed) return trimmed;
  if (members[0]) return members[0];
  return null; // raqam berilgach oʻsha qoʻyiladi
}

export async function createWalkInTeam(
  _prev: CheckInResult | null,
  formData: FormData,
): Promise<CheckInResult> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const parsed = walkInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Maʼlumot toʻliq emas" };
  }
  const input = parsed.data;

  const members = (input.members ?? "")
    .split(/[,\n]/)
    .map((m) => m.trim())
    .filter(Boolean);

  if (members.length === 0 && !(input.name ?? "").trim()) {
    return { ok: false, error: "Kamida ishtirokchi ismini yozing" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const resolved = resolveTeamName(input.name, members);

      const [team] = await tx
        .insert(schema.teams)
        .values({
          categoryCode: input.categoryCode,
          // Vaqtincha nom — raqam berilgach kerak boʻlsa almashtiriladi
          name: resolved ?? "…",
          walkIn: true,
          searchText: normalizeSearch([resolved, members.join(" ")].filter(Boolean).join(" ")),
        })
        .returning({ id: schema.teams.id });

      for (const member of members) {
        await tx.insert(schema.participants).values({ teamId: team.id, fullName: member });
      }

      // Raqam bu yerda berilmaydi — keyingi qadamda yorliq biriktiriladi
      const finalName = resolved ?? `Jamoa ${team.id}`;
      if (!resolved) {
        await tx
          .update(schema.teams)
          .set({ name: finalName, searchText: normalizeSearch(finalName) })
          .where(eq(schema.teams.id, team.id));
      }

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: "team.walkin",
        entity: "team",
        entityId: String(team.id),
        after: { ...input, name: finalName },
      });

      return { teamId: team.id, name: finalName };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin");
    return { ok: true, teamId: result.teamId, number: "", name: result.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Robot surati
   ============================================================ */

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export async function saveRobotPhoto(
  rawTeamId: unknown,
  dataUrl: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Notoʻgʻri jamoa" };

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    typeof dataUrl === "string" ? dataUrl : "",
  );
  if (!match) return { ok: false, error: "Surat formati notoʻgʻri" };

  const [, ext, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, error: "Surat juda katta" };
  }

  try {
    const [team] = await db
      .select({ number: schema.teams.number, categoryCode: schema.teams.categoryCode })
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId));
    if (!team) return { ok: false, error: "Jamoa topilmadi" };

    const dir = path.resolve(env.UPLOAD_DIR);
    await mkdir(dir, { recursive: true });

    const fileName = `${team.number ?? "team-" + teamId}-${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;
    await writeFile(path.join(dir, fileName), buffer);

    await db.insert(schema.robots).values({
      teamId,
      photoPath: fileName,
      capturedBy: staff.name,
    });

    return { ok: true, path: fileName };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
