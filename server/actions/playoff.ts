"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { requireAdmin } from "@/lib/auth/session";
import { CATEGORIES, isCategoryCode } from "@/lib/categories";
import { assignFields, createPlayoffBracket } from "@/server/lib/progression";

export type PlayoffState = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Pleyoffni QOʻLDA tuzish.
 *
 * Odatda kerak emas: guruh bosqichining oxirgi natijasi yozilishi bilan
 * pleyoff `advanceCategory` ichida oʻzi tuziladi. Bu tugma zaxira —
 * masalan oʻyin bekor qilingandan keyin qayta tuzish kerak boʻlsa.
 */
export async function generatePlayoff(categoryCode: string): Promise<PlayoffState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };
  if (!isCategoryCode(categoryCode)) return { ok: false, error: "Notoʻgʻri yoʻnalish" };
  if (CATEGORIES[categoryCode].format !== "group_playoff") {
    return { ok: false, error: "Bu yoʻnalishda guruh bosqichi yoʻq" };
  }

  try {
    const summary = await db.transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.code, categoryCode))
        .for("update");
      if (!settings?.drawLocked) throw new Error("Avval jerebyovka oʻtkazing");

      const [already] = await tx
        .select({ id: schema.matches.id })
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.categoryCode, categoryCode),
            eq(schema.matches.stage, "playoff"),
          ),
        )
        .limit(1);
      if (already) throw new Error("Pleyoff allaqachon tuzilgan");

      const groupMatches = await tx
        .select({
          groupId: schema.matches.groupId,
          teamAId: schema.matches.teamAId,
          teamBId: schema.matches.teamBId,
          scoreA: schema.matches.scoreA,
          scoreB: schema.matches.scoreB,
          status: schema.matches.status,
        })
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.categoryCode, categoryCode),
            eq(schema.matches.stage, "group"),
          ),
        );

      if (groupMatches.length === 0) throw new Error("Guruh oʻyinlari topilmadi");

      const unfinished = groupMatches.filter((m) => m.status !== "done").length;
      if (unfinished > 0) {
        throw new Error(
          `Guruh bosqichida ${unfinished} ta oʻyin yakunlanmagan — pleyoffni hozir tuzib boʻlmaydi.`,
        );
      }

      const { qualified, totalRounds } = await createPlayoffBracket(
        tx,
        categoryCode,
        groupMatches,
        settings.fieldCount,
        admin.name,
      );
      await assignFields(tx, categoryCode, settings.fieldCount);

      const text = `${qualified.length} jamoa pleyoffga chiqdi · ${totalRounds} bosqich`;
      await emit(tx, categoryCode, "draw.completed", { categoryCode, summary: text });
      return text;
    });

    revalidatePath("/admin/draw");
    revalidatePath(`/jonli/${CATEGORIES[categoryCode].slug}`);
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Guruh bosqichi tugadimi — tugma faolligini aniqlash uchun. */
export async function groupStageStatus(categoryCode: string) {
  if (!isCategoryCode(categoryCode)) return null;

  const rows = await db
    .select({ status: schema.matches.status })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.categoryCode, categoryCode),
        ne(schema.matches.stage, "playoff"),
      ),
    );

  const total = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  return { total, done, complete: total > 0 && done === total };
}
