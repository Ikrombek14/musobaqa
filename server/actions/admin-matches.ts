"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { requireAdmin } from "@/lib/auth/session";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import { advanceCategory, advanceWinner, type Tx } from "@/server/lib/progression";
import { toId, toInt } from "@/lib/validate";

export type MatchEditState = { ok: true; message: string } | { ok: false; error: string };

/**
 * Tashkilotchi natijani tuzatadi.
 *
 * Hakam oʻz maydonidagi oʻyinnigina koʻradi va keyingi bosqich
 * boshlangach umuman tegolmaydi. Admin esa butun jadvalni koʻradi —
 * nizo chiqsa yoki hakam notoʻgʻri yozib qoʻysa tuzatish shu yerdan
 * boʻladi. Har oʻzgarish audit jurnaliga admin nomi bilan tushadi.
 *
 * Cheklovlar hakamdagi bilan bir xil, sabab ham bir xil:
 *  • keyingi bosqich oʻyini boshlangan boʻlsa — gʻolibni almashtirsak
 *    oʻynab boʻlingan oʻyin ishtirokchisi oʻzgarib ketardi;
 *  • guruh natijasi, pleyoff esa allaqachon tuzilgan — jadval
 *    oʻzgaradi, toʻr esa oʻzgarmaydi.
 */
async function guardEditable(
  tx: Tx,
  match: {
    id: number;
    stage: string;
    categoryCode: string;
    nextMatchId: number | null;
  },
): Promise<void> {
  if (match.nextMatchId) {
    const [next] = await tx
      .select({ status: schema.matches.status })
      .from(schema.matches)
      .where(eq(schema.matches.id, match.nextMatchId));
    if (next && next.status !== "pending") {
      throw new Error(
        "Keyingi bosqich oʻyini boshlangan — avval oʻshaning natijasini tozalang.",
      );
    }
  }

  if (match.stage === "group") {
    const [playoff] = await tx
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.categoryCode, match.categoryCode),
          eq(schema.matches.stage, "playoff"),
        ),
      )
      .limit(1);
    if (playoff) {
      throw new Error(
        "Pleyoff tuzilgan — guruh natijasini oʻzgartirish jadvalni toʻrga mos kelmay qoldiradi.",
      );
    }
  }
}

export async function setMatchResult(
  rawMatchId: unknown,
  rawScoreA: unknown,
  rawScoreB: unknown,
): Promise<MatchEditState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const matchId = toId(rawMatchId);
  if (matchId === null) return { ok: false, error: "Oʻyin topilmadi" };

  const scoreA = toInt(rawScoreA, { min: 0, max: 99 });
  const scoreB = toInt(rawScoreB, { min: 0, max: 99 });
  if (scoreA === null || scoreB === null) {
    return { ok: false, error: "Hisob 0–99 oraligʻida butun son boʻlsin" };
  }
  if (scoreA === scoreB) {
    return { ok: false, error: "Durrang saqlanmaydi — gʻolib aniqlanishi shart" };
  }

  try {
    const message = await db.transaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, matchId))
        .for("update");
      if (!match) throw new Error("Oʻyin topilmadi");
      if (match.isBye) throw new Error("Raqibsiz oʻtgan oʻyin tahrirlanmaydi");
      if (match.teamAId === null || match.teamBId === null) {
        throw new Error("Ikkala ishtirokchi hali aniqlanmagan");
      }

      await guardEditable(tx, match);

      const winnerId = scoreA > scoreB ? match.teamAId : match.teamBId;

      await tx
        .update(schema.matches)
        .set({
          scoreA,
          scoreB,
          winnerId,
          status: "done",
          finishedAt: match.finishedAt ?? new Date(),
        })
        .where(eq(schema.matches.id, matchId));

      if (match.stage === "playoff") await advanceWinner(tx, matchId, winnerId);

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "match.admin_edit",
        entity: "match",
        entityId: String(matchId),
        before: { scoreA: match.scoreA, scoreB: match.scoreB, status: match.status },
        after: { scoreA, scoreB, status: "done" },
      });

      await emit(tx, match.categoryCode, "match.updated", {
        matchId,
        scoreA,
        scoreB,
        winnerId,
        status: "done",
      });

      await advanceCategory(tx, match.categoryCode as CategoryCode, admin.name);

      return `Natija saqlandi: ${scoreA}:${scoreB}`;
    });

    revalidateAll();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Natijani tozalash — oʻyin «kutilmoqda» holatiga qaytadi. */
export async function clearMatchResult(rawMatchId: unknown): Promise<MatchEditState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const matchId = toId(rawMatchId);
  if (matchId === null) return { ok: false, error: "Oʻyin topilmadi" };

  try {
    const message = await db.transaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, matchId))
        .for("update");
      if (!match) throw new Error("Oʻyin topilmadi");
      if (match.isBye) throw new Error("Raqibsiz oʻtgan oʻyin tahrirlanmaydi");

      await guardEditable(tx, match);

      // Gʻolib keyingi bosqichga koʻchgan boʻlsa — qaytarib olamiz
      if (match.stage === "playoff") await advanceWinner(tx, matchId, null);

      await tx
        .update(schema.matches)
        .set({
          scoreA: 0,
          scoreB: 0,
          winnerId: null,
          roundsJson: null,
          status: "pending",
          finishedAt: null,
        })
        .where(eq(schema.matches.id, matchId));

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "match.admin_clear",
        entity: "match",
        entityId: String(matchId),
        before: { scoreA: match.scoreA, scoreB: match.scoreB, winnerId: match.winnerId },
      });

      await emit(tx, match.categoryCode, "match.reverted", {
        matchId,
        scoreA: 0,
        scoreB: 0,
        winnerId: null,
        status: "pending",
      });

      return "Natija tozalandi — oʻyin qaytadan yoziladi";
    });

    revalidateAll();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function revalidateAll() {
  revalidatePath("/admin/juftliklar");
  revalidatePath("/admin");
  revalidatePath("/hakam");
  for (const category of Object.values(CATEGORIES)) {
    revalidatePath(`/jonli/${category.slug}`);
  }
  revalidatePath("/");
}
