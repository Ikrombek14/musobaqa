"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { requireAdmin, AuthError } from "@/lib/auth/session";
import { CATEGORIES, isCategoryCode, type CategoryCode } from "@/lib/categories";
import { buildBracket, drawGroups, roundRobin, type DrawTeam } from "@/lib/draw/engine";
import { createSeed, createRng, shuffle } from "@/lib/draw/rng";
import { assignFields, insertBracket } from "@/server/lib/progression";

export type DrawState =
  | { ok: true; seed: string; warnings: string[]; summary: string }
  | { ok: false; error: string };

/**
 * Jerebyovka o'tkazish.
 *
 * Butun ish BITTA tranzaksiyada: yarim tuzilgan to'r bazada qolmaydi.
 * Seed saqlanadi — nizo chiqsa natijani qayta hisoblab isbotlash mumkin.
 */
export async function runDraw(categoryCode: string): Promise<DrawState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    return { ok: false, error: err instanceof AuthError ? err.message : "Ruxsat yoʻq" };
  }

  if (!isCategoryCode(categoryCode)) {
    return { ok: false, error: "Notoʻgʻri yoʻnalish" };
  }
  const category = CATEGORIES[categoryCode];

  try {
    const result = await db.transaction(async (tx) => {
      // Yo'nalish qatorini qulflaymiz — ikki admin bir vaqtda bosa olmaydi
      const [settings] = await tx
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.code, categoryCode))
        .for("update");

      if (!settings) throw new Error("Yoʻnalish topilmadi");
      if (settings.drawLocked) {
        throw new Error(
          "Bu yoʻnalishda jerebyovka allaqachon oʻtkazilgan. Avval bekor qiling.",
        );
      }

      // Faqat check-in qilingan jamoalar qatnashadi
      const teams = await tx
        .select({
          id: schema.teams.id,
          name: schema.teams.name,
          school: schema.teams.school,
          number: schema.teams.number,
        })
        .from(schema.teams)
        .where(
          and(
            eq(schema.teams.categoryCode, categoryCode),
            isNotNull(schema.teams.checkedInAt),
          ),
        )
        .orderBy(asc(schema.teams.numberSeq));

      if (teams.length < 2) {
        throw new Error(
          `Jerebyovka uchun kamida 2 ta check-in qilingan jamoa kerak (hozir ${teams.length} ta).`,
        );
      }

      const seed = createSeed();
      const drawTeams: DrawTeam[] = teams.map((t) => ({
        id: t.id,
        name: t.name,
        school: t.school,
      }));

      let warnings: string[] = [];
      let resultJson: unknown;
      let summary: string;

      if (category.format === "group_playoff") {
        const out = await drawGroupStage(tx, categoryCode, drawTeams, settings.groupSize, seed);
        warnings = out.warnings;
        resultJson = out.resultJson;
        summary = out.summary;
      } else if (category.format === "single_elim") {
        const out = await drawSingleElim(tx, categoryCode, drawTeams, seed, settings.fieldCount);
        resultJson = out.resultJson;
        summary = out.summary;
      } else {
        const out = drawStartOrder(drawTeams, seed);
        resultJson = out.resultJson;
        summary = out.summary;
      }

      await tx.insert(schema.draws).values({
        categoryCode,
        seed,
        teamIds: teams.map((t) => t.id),
        resultJson,
        warnings,
        createdBy: admin.name,
      });

      await tx
        .update(schema.categories)
        .set({ drawLocked: true })
        .where(eq(schema.categories.code, categoryCode));

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "draw.run",
        entity: "category",
        entityId: categoryCode,
        after: { seed, teamCount: teams.length, summary },
      });

      await emit(tx, categoryCode, "draw.completed", {
        categoryCode,
        teamCount: teams.length,
        summary,
      });

      return { seed, warnings, summary };
    });

    revalidatePath("/admin/draw");
    revalidatePath(`/jonli/${category.slug}`);
    revalidatePath("/jonli");

    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ============================================================
   Guruh + pleyoff (robofutbol)
   ============================================================ */
async function drawGroupStage(
  tx: Tx,
  categoryCode: CategoryCode,
  teams: DrawTeam[],
  groupSize: number,
  seed: string,
) {
  const { groups, warnings } = drawGroups(teams, groupSize, seed);

  const created: { id: number; name: string; teamIds: number[] }[] = [];
  for (const group of groups) {
    const [row] = await tx
      .insert(schema.groups)
      .values({ categoryCode, name: group.name })
      .returning({ id: schema.groups.id });

    for (const [position, teamId] of group.teamIds.entries()) {
      await tx.insert(schema.groupTeams).values({ groupId: row.id, teamId, position });
    }
    created.push({ id: row.id, name: group.name, teamIds: group.teamIds });
  }

  // Guruh o'yinlari. Turlar bo'yicha aralashtiramiz: bir jamoa ketma-ket
  // ikki o'yin o'ynamasin, maydonlar esa parallel band bo'lsin.
  const [settings] = await tx
    .select({ fieldCount: schema.categories.fieldCount })
    .from(schema.categories)
    .where(eq(schema.categories.code, categoryCode));
  const fieldCount = Math.max(1, settings?.fieldCount ?? 1);

  type Pending = { groupId: number; a: number; b: number; round: number };
  const pending: Pending[] = [];
  for (const group of created) {
    for (const pair of roundRobin(group.teamIds)) {
      pending.push({ groupId: group.id, a: pair.a, b: pair.b, round: pair.round });
    }
  }
  pending.sort((x, y) => x.round - y.round || x.groupId - y.groupId);

  let orderNo = 0;
  for (const match of pending) {
    await tx.insert(schema.matches).values({
      categoryCode,
      stage: "group",
      groupId: match.groupId,
      round: match.round,
      slot: orderNo,
      orderNo,
      fieldNo: (orderNo % fieldCount) + 1,
      teamAId: match.a,
      teamBId: match.b,
      status: "pending",
    });
    orderNo++;
  }

  return {
    warnings,
    resultJson: {
      format: "group_playoff",
      groups: created.map((g) => ({ name: g.name, teamIds: g.teamIds })),
      matchCount: pending.length,
    },
    summary:
      `${created.length} guruh · ${pending.length} guruh oʻyini. ` +
      `Pleyoff guruh bosqichi tugagach tuziladi.`,
  };
}

/* ============================================================
   Olib tashlash to'ri (sumo, robrace)
   ============================================================ */
async function drawSingleElim(
  tx: Tx,
  categoryCode: CategoryCode,
  teams: DrawTeam[],
  seed: string,
  fieldCount: number,
) {
  const bracket = buildBracket(
    teams.map((t) => t.id),
    seed,
  );

  await insertBracket(tx, categoryCode, "playoff", bracket, fieldCount);

  // Bay tufayli 2-turda darhol tayyor boʻlgan oʻyinlarga maydon beramiz
  await assignFields(tx, categoryCode, fieldCount);

  return {
    resultJson: {
      format: "single_elim",
      size: bracket.size,
      totalRounds: bracket.totalRounds,
      byes: bracket.byes,
      matches: bracket.matches.map((m) => ({
        round: m.round,
        slot: m.slot,
        a: m.teamAId,
        b: m.teamBId,
      })),
    },
    summary:
      `${teams.length} jamoa · ${bracket.totalRounds} bosqich` +
      (bracket.byes > 0 ? ` · ${bracket.byes} ta bay` : ""),
  };
}

/* ============================================================
   Start tartibi (linefollower)
   ============================================================ */
function drawStartOrder(teams: DrawTeam[], seed: string) {
  const rng = createRng(seed);
  const order = shuffle(
    teams.map((t) => t.id),
    rng,
  );
  return {
    resultJson: { format: "time_trial", startOrder: order },
    summary: `${teams.length} jamoa · start tartibi belgilandi`,
  };
}

/* ============================================================
   Bekor qilish
   ============================================================ */
export async function cancelDraw(categoryCode: string): Promise<DrawState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { ok: false, error: "Ruxsat yoʻq" };
  }
  if (!isCategoryCode(categoryCode)) return { ok: false, error: "Notoʻgʻri yoʻnalish" };

  try {
    await db.transaction(async (tx) => {
      // Natija yozilgan bo'lsa bekor qilinmaydi — musobaqa boshlangan.
      const [played] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.categoryCode, categoryCode),
            eq(schema.matches.status, "done"),
            eq(schema.matches.isBye, false),
          ),
        );

      if ((played?.count ?? 0) > 0) {
        throw new Error(
          `Bu yoʻnalishda ${played.count} ta oʻyin natijasi yozilgan — jerebyovkani bekor qilib boʻlmaydi.`,
        );
      }

      await tx.delete(schema.matches).where(eq(schema.matches.categoryCode, categoryCode));
      await tx.delete(schema.groups).where(eq(schema.groups.categoryCode, categoryCode));
      await tx
        .update(schema.draws)
        .set({ cancelledAt: new Date() })
        .where(
          and(
            eq(schema.draws.categoryCode, categoryCode),
            sql`${schema.draws.cancelledAt} is null`,
          ),
        );
      await tx
        .update(schema.categories)
        .set({ drawLocked: false })
        .where(eq(schema.categories.code, categoryCode));

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "draw.cancel",
        entity: "category",
        entityId: categoryCode,
      });

      await emit(tx, categoryCode, "draw.cancelled", { categoryCode });
    });

    revalidatePath("/admin/draw");
    revalidatePath(`/jonli/${CATEGORIES[categoryCode].slug}`);
    return { ok: true, seed: "", warnings: [], summary: "Jerebyovka bekor qilindi" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
