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
  if (teamId === null) {
    return { ok: false, error: "Notoʻgʻri jamoa" };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ allocate_team_number: string }>(
        sql`select allocate_team_number(${teamId}, ${staff.name})`,
      );
      const number = rows[0]?.allocate_team_number;
      if (!number) throw new Error("Raqam berilmadi");

      const [team] = await tx
        .select({ name: schema.teams.name, categoryCode: schema.teams.categoryCode })
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId));

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: "team.checkin",
        entity: "team",
        entityId: String(teamId),
        after: { number },
      });

      await emit(tx, team.categoryCode, "team.checked_in", {
        teamId,
        number,
        name: team.name,
      });

      return { number, name: team.name };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin");
    return { ok: true, teamId, number: result.number, name: result.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   «Roʻyxatda yoʻq» — joyida qoʻshish
   ============================================================ */

const walkInSchema = z.object({
  categoryCode: z.string().refine(isCategoryCode, "Yoʻnalish tanlanmagan"),
  name: z.string().trim().min(2, "Jamoa nomi kamida 2 belgi"),
  school: z.string().trim().max(120).optional().or(z.literal("")),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  coach: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  members: z.string().trim().max(500).optional().or(z.literal("")),
});

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

  try {
    const result = await db.transaction(async (tx) => {
      const [team] = await tx
        .insert(schema.teams)
        .values({
          categoryCode: input.categoryCode,
          name: input.name,
          school: input.school || null,
          region: input.region || null,
          coach: input.coach || null,
          phone: input.phone || null,
          walkIn: true,
          searchText: normalizeSearch(
            [input.name, input.school, input.coach, input.region, input.members]
              .filter(Boolean)
              .join(" "),
          ),
        })
        .returning({ id: schema.teams.id });

      const members = (input.members ?? "")
        .split(/[,\n]/)
        .map((m) => m.trim())
        .filter(Boolean);

      for (const member of members) {
        await tx.insert(schema.participants).values({ teamId: team.id, fullName: member });
      }

      const { rows } = await tx.execute<{ allocate_team_number: string }>(
        sql`select allocate_team_number(${team.id}, ${staff.name})`,
      );
      const number = rows[0].allocate_team_number;

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: "team.walkin",
        entity: "team",
        entityId: String(team.id),
        after: { ...input, number },
      });

      await emit(tx, input.categoryCode, "team.checked_in", {
        teamId: team.id,
        number,
        name: input.name,
      });

      return { teamId: team.id, number };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin");
    return { ok: true, teamId: result.teamId, number: result.number, name: input.name };
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
