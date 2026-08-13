"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { requireStaff } from "@/lib/auth/session";
import { isCategoryCode, parseTagCode } from "@/lib/categories";
import { toId } from "@/lib/validate";

export type TagResult =
  | { ok: true; teamId: number; code: string; name: string }
  | { ok: false; error: string };

/**
 * Yorliqni jamoaga biriktirish.
 *
 * Raqam avtomatik berilmaydi: admin robotga chop etilgan qogʻozni
 * yopishtiradi va oʻsha koddagi yorliqni jamoaga bogʻlaydi.
 *
 * Qulf (`for update`) shart: ikki stol bir vaqtda «F12» ni kiritsa,
 * ikkinchisi xato oladi — bitta yorliq ikki jamoaga tegmaydi.
 */
export async function assignTag(
  rawTeamId: unknown,
  rawCode: unknown,
): Promise<TagResult> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Notoʻgʻri jamoa" };

  const parsed = parseTagCode(String(rawCode ?? ""));
  if (!parsed) {
    return {
      ok: false,
      error: "Kod notoʻgʻri. Masalan: F12, S7, LS3, LF21, RC9",
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [team] = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId))
        .for("update");
      if (!team) throw new Error("Jamoa topilmadi");

      if (team.categoryCode !== parsed.categoryCode) {
        throw new Error(
          `«${parsed.code}» boshqa yoʻnalish yorligʻi. Bu jamoa — ${team.categoryCode}.`,
        );
      }

      const [tag] = await tx
        .select()
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.categoryCode, parsed.categoryCode),
            eq(schema.tags.code, parsed.code),
          ),
        )
        .for("update");

      if (!tag) throw new Error(`«${parsed.code}» yorligʻi mavjud emas`);

      if (tag.teamId !== null && tag.teamId !== teamId) {
        const [other] = await tx
          .select({ name: schema.teams.name })
          .from(schema.teams)
          .where(eq(schema.teams.id, tag.teamId));
        throw new Error(
          `«${parsed.code}» allaqachon band: ${other?.name ?? "boshqa jamoa"}`,
        );
      }

      // Jamoaning eski yorligʻi boʻlsa boʻshatamiz (xato kod kiritilgan boʻlsa)
      await tx
        .update(schema.tags)
        .set({ teamId: null, assignedAt: null, assignedBy: null })
        .where(and(eq(schema.tags.teamId, teamId), sql`${schema.tags.id} <> ${tag.id}`));

      await tx
        .update(schema.tags)
        .set({ teamId, assignedAt: new Date(), assignedBy: staff.name })
        .where(eq(schema.tags.id, tag.id));

      await tx
        .update(schema.teams)
        .set({
          number: parsed.code,
          numberSeq: parsed.number,
          checkedInAt: team.checkedInAt ?? new Date(),
          checkedInBy: team.checkedInBy ?? staff.name,
        })
        .where(eq(schema.teams.id, teamId));

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: "tag.assign",
        entity: "team",
        entityId: String(teamId),
        before: { number: team.number },
        after: { number: parsed.code },
      });

      await emit(tx, team.categoryCode, "team.checked_in", {
        teamId,
        number: parsed.code,
        name: team.name,
      });

      return { code: parsed.code, name: team.name };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    return { ok: true, teamId, code: result.code, name: result.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Biriktirishni bekor qilish — yorliq boʻshaydi, qayta ishlatiladi. */
export async function releaseTag(rawTeamId: unknown): Promise<TagResult> {
  const staff = await requireStaff().catch(() => null);
  if (!staff) return { ok: false, error: "Qayta kiring" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Notoʻgʻri jamoa" };

  try {
    const result = await db.transaction(async (tx) => {
      const [team] = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId))
        .for("update");
      if (!team) throw new Error("Jamoa topilmadi");

      await tx
        .update(schema.tags)
        .set({ teamId: null, assignedAt: null, assignedBy: null })
        .where(eq(schema.tags.teamId, teamId));

      await tx
        .update(schema.teams)
        .set({ number: null, numberSeq: null, checkedInAt: null, checkedInBy: null })
        .where(eq(schema.teams.id, teamId));

      await tx.insert(schema.auditLog).values({
        actor: staff.name,
        action: "tag.release",
        entity: "team",
        entityId: String(teamId),
        before: { number: team.number },
      });

      await emit(tx, team.categoryCode, "team.checked_in", {
        teamId,
        number: null,
        name: team.name,
        undone: true,
      });

      return { code: team.number ?? "", name: team.name };
    });

    revalidatePath("/admin/checkin");
    revalidatePath("/admin/jamoalar");
    return { ok: true, teamId, code: result.code, name: result.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Yoʻnalishdagi boʻsh yorliqlar — keyingi kodni taklif qilish uchun. */
export async function nextFreeTag(categoryCode: string): Promise<string | null> {
  await requireStaff();
  if (!isCategoryCode(categoryCode)) return null;

  const [tag] = await db
    .select({ code: schema.tags.code })
    .from(schema.tags)
    .where(
      and(eq(schema.tags.categoryCode, categoryCode), isNull(schema.tags.teamId)),
    )
    .orderBy(asc(schema.tags.number))
    .limit(1);

  return tag?.code ?? null;
}
