"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { emit } from "@/lib/realtime/emit";
import { requireStaff } from "@/lib/auth/session";
import { CATEGORIES, isCategoryCode } from "@/lib/categories";
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
   Roʻyxatdagi maʼlumotni stolda tuzatish
   ============================================================ */

const editSchema = z.object({
  teamId: z.coerce.number().int().positive(),
  categoryCode: z.string().refine(isCategoryCode, "Yoʻnalish tanlanmagan"),
  name: z.string().trim().min(2, "Ism kamida 2 belgi").max(120),
  members: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Yoʻnalishni (va ism/ishtirokchilarni) roʻyxatdan oʻtkazish paytida tuzatish.
 *
 * Haqiqiy holat: bola roʻyxatda «Arduino Sumo» deb yozilgan, lekin stolga
 * kelib «men robofutboldan qatnashaman» deydi. Ilgari buning yoʻli
 * yoʻq edi — admin jamoani oʻchirib qaytadan qoʻshishi kerak boʻlardi.
 *
 * Yoʻnalish oʻzgarsa yorliq ham boʻshaydi: S12 qogʻozi robofutbolda
 * ishlamaydi, prefiks mos kelmaydi. Bola yangi qogʻozni oladi va
 * keyingi qadamda F prefiksli kod kiritiladi.
 *
 * Ikki holatda rad etiladi:
 *  • jamoa jadvalga tushgan — jerebyovka natijasi buziladi;
 *  • yangi yoʻnalishda jerebyovka oʻtkazilgan — kech qoʻshilgan jamoa
 *    hech qaysi guruhga tushmaydi va «tizimda bor, lekin oʻynamaydi»
 *    holatiga tushib qoladi.
 */
export async function updateTeamAtCheckIn(
  _prev: CheckInResult | null,
  formData: FormData,
): Promise<CheckInResult> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Maʼlumot notoʻgʻri" };
  }
  const input = parsed.data;

  const members = (input.members ?? "")
    .split(/[,\n]/)
    .map((m) => m.trim())
    .filter(Boolean);

  try {
    const result = await db.transaction(async (tx) => {
      const [team] = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, input.teamId))
        .for("update");
      if (!team) throw new Error("Jamoa topilmadi");

      const moved = team.categoryCode !== input.categoryCode;

      if (moved) {
        const [inMatch] = await tx
          .select({ id: schema.matches.id })
          .from(schema.matches)
          .where(
            or(
              eq(schema.matches.teamAId, input.teamId),
              eq(schema.matches.teamBId, input.teamId),
            ),
          )
          .limit(1);
        if (inMatch) {
          throw new Error(
            "Bu jamoa jadvalga kiritilgan — avval jerebyovkani bekor qiling.",
          );
        }

        const [target] = await tx
          .select({ drawLocked: schema.categories.drawLocked, name: schema.categories.name })
          .from(schema.categories)
          .where(eq(schema.categories.code, input.categoryCode));
        if (!target) throw new Error("Yoʻnalish topilmadi");
        if (target.drawLocked) {
          throw new Error(
            `${target.name} boʻyicha jerebyovka oʻtkazilgan — yangi jamoa qoʻshib boʻlmaydi.`,
          );
        }

        // Eski yoʻnalishning yorligʻi boʻshaydi: prefiks mos kelmaydi
        await tx
          .update(schema.tags)
          .set({ teamId: null, assignedAt: null, assignedBy: null })
          .where(eq(schema.tags.teamId, input.teamId));

        // Guruhga tushgan boʻlsa (jerebyovkasiz ham boʻlishi mumkin) — chiqaramiz
        await tx
          .delete(schema.groupTeams)
          .where(eq(schema.groupTeams.teamId, input.teamId));
      }

      await tx
        .update(schema.teams)
        .set({
          categoryCode: input.categoryCode,
          name: input.name,
          // Yoʻnalish oʻzgarsa raqam ham yaroqsiz
          number: moved ? null : team.number,
          numberSeq: moved ? null : team.numberSeq,
          searchText: normalizeSearch(
            [input.name, team.school, team.coach, team.region, members.join(" ")]
              .filter(Boolean)
              .join(" "),
          ),
          updatedAt: new Date(),
        })
        .where(eq(schema.teams.id, input.teamId));

      if (members.length > 0) {
        await tx.delete(schema.participants).where(eq(schema.participants.teamId, input.teamId));
        for (const member of members) {
          await tx.insert(schema.participants).values({ teamId: input.teamId, fullName: member });
        }
      }

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: moved ? "team.move_category" : "team.update",
        entity: "team",
        entityId: String(input.teamId),
        before: { categoryCode: team.categoryCode, name: team.name, number: team.number },
        after: { categoryCode: input.categoryCode, name: input.name },
      });

      // Ikkala kanalga ham: eski yoʻnalish roʻyxatidan chiqadi, yangisiga qoʻshiladi
      if (moved) {
        await emit(tx, team.categoryCode, "team.checked_in", {
          teamId: input.teamId,
          name: input.name,
          movedFrom: team.categoryCode,
        });
      }
      await emit(tx, input.categoryCode, "team.checked_in", {
        teamId: input.teamId,
        name: input.name,
        number: moved ? null : team.number,
        edited: true,
      });

      return {
        ok: true as const,
        teamId: input.teamId,
        number: moved ? "" : (team.number ?? ""),
        name: input.name,
      };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    return result;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Sherik — bitta raqam ostidagi ikkinchi ishtirokchi
   ============================================================ */

/**
 * Ikki roʻyxat qatorini bitta jamoaga birlashtiradi.
 *
 * Robofutbolda ikki bola bitta raqam ostida oʻynaydi: F1 qogʻozi ikki
 * nusxada chop etilgan, har robotga bittadan yopishtiriladi. Roʻyxatda
 * esa ular alohida-alohida yozilgan — stolda birlashtiriladi.
 *
 * `source` qatori oʻchadi, ishtirokchilari `target` ga koʻchadi.
 * Uchinchisi qoʻshilmaydi: `maxMembers` chegarasi tekshiriladi.
 */
export async function addPartner(
  rawTargetId: unknown,
  rawSourceId: unknown,
): Promise<CheckInResult> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const targetId = toId(rawTargetId);
  const sourceId = toId(rawSourceId);
  if (targetId === null || sourceId === null) return { ok: false, error: "Notoʻgʻri jamoa" };
  if (targetId === sourceId) return { ok: false, error: "Bitta odamni oʻziga qoʻshib boʻlmaydi" };

  try {
    const result = await db.transaction(async (tx) => {
      // Har doim kichik id birinchi qulflanadi — ikki stol bir vaqtda
      // birlashtirsa ham deadlock boʻlmaydi
      const ids = [targetId, sourceId].sort((a, b) => a - b);
      const locked = await tx
        .select()
        .from(schema.teams)
        .where(inArray(schema.teams.id, ids))
        .for("update");

      const target = locked.find((t) => t.id === targetId);
      const source = locked.find((t) => t.id === sourceId);
      if (!target || !source) throw new Error("Jamoa topilmadi");

      if (target.categoryCode !== source.categoryCode) {
        throw new Error("Ikkalasi bir yoʻnalishda boʻlishi kerak");
      }

      const limit = isCategoryCode(target.categoryCode)
        ? CATEGORIES[target.categoryCode].maxMembers
        : 1;

      const counts = await tx
        .select({ teamId: schema.participants.teamId, n: sql<number>`count(*)::int` })
        .from(schema.participants)
        .where(inArray(schema.participants.teamId, ids))
        .groupBy(schema.participants.teamId);

      const have = counts.find((c) => c.teamId === targetId)?.n ?? 0;
      const adding = counts.find((c) => c.teamId === sourceId)?.n ?? 0;

      if (have + adding > limit) {
        throw new Error(
          `Bitta raqamga ${limit} ta ishtirokchi biriktiriladi — ${target.number ?? "bu raqam"} da ${have} ta bor.`,
        );
      }

      // Jadvalga tushgan qatorni oʻchirib boʻlmaydi
      const [inMatch] = await tx
        .select({ id: schema.matches.id })
        .from(schema.matches)
        .where(or(eq(schema.matches.teamAId, sourceId), eq(schema.matches.teamBId, sourceId)))
        .limit(1);
      if (inMatch) {
        throw new Error("Sherik jadvalga kiritilgan — avval jerebyovkani bekor qiling.");
      }

      await tx
        .update(schema.participants)
        .set({ teamId: targetId })
        .where(eq(schema.participants.teamId, sourceId));

      // Sherikning oʻz yorligʻi boʻlsa boʻshaydi: ikkalasi bitta raqamda
      await tx
        .update(schema.tags)
        .set({ teamId: null, assignedAt: null, assignedBy: null })
        .where(eq(schema.tags.teamId, sourceId));

      await tx.delete(schema.teams).where(eq(schema.teams.id, sourceId));

      const names = await tx
        .select({ fullName: schema.participants.fullName })
        .from(schema.participants)
        .where(eq(schema.participants.teamId, targetId));

      await tx
        .update(schema.teams)
        .set({
          searchText: normalizeSearch(
            [target.name, target.school, target.coach, source.name, ...names.map((n) => n.fullName)]
              .filter(Boolean)
              .join(" "),
          ),
          updatedAt: new Date(),
        })
        .where(eq(schema.teams.id, targetId));

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: "team.add_partner",
        entity: "team",
        entityId: String(targetId),
        before: { sourceId, sourceName: source.name, sourceNumber: source.number },
        after: { targetId, number: target.number, members: names.map((n) => n.fullName) },
      });

      await emit(tx, target.categoryCode, "team.checked_in", {
        teamId: targetId,
        number: target.number,
        name: target.name,
        merged: sourceId,
      });

      return {
        ok: true as const,
        teamId: targetId,
        number: target.number ?? "",
        name: target.name,
      };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    return result;
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

  const limit = CATEGORIES[input.categoryCode as keyof typeof CATEGORIES].maxMembers;
  if (members.length > limit) {
    return {
      ok: false,
      error: `${CATEGORIES[input.categoryCode as keyof typeof CATEGORIES].name}da bitta raqamga ${limit} ta ishtirokchi biriktiriladi.`,
    };
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
