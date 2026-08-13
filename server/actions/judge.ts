"use server";

import { revalidatePath } from "next/cache";
import { verify } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { getSession, requireJudge } from "@/lib/auth/session";
import { advanceCategory, advanceWinner, type Tx } from "@/server/lib/progression";
import { CATEGORIES, PENALTY_MS, type CategoryCode } from "@/lib/categories";
import { toId, toInt } from "@/lib/validate";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/* ============================================================
   Kirish
   ============================================================ */

export async function judgeLogin(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const pin = String(formData.get("pin") ?? "").trim();
  if (!/^\d{4,8}$/.test(pin)) {
    return { ok: false, error: "PIN 4–8 raqamdan iborat boʻlishi kerak" };
  }

  // PIN qaysi hakamniki ekanini bilmaymiz — faol hakamlarni ko'rib chiqamiz.
  // Musobaqada hakamlar soni o'nlab, bu arzon amal.
  const judges = await db
    .select()
    .from(schema.judges)
    .where(eq(schema.judges.active, true));

  let matched: (typeof judges)[number] | null = null;
  for (const judge of judges) {
    if (await verify(judge.pinHash, pin)) {
      matched = judge;
      break;
    }
  }

  if (!matched) return { ok: false, error: "PIN notoʻgʻri" };

  const session = await getSession();
  session.judge = {
    id: matched.id,
    name: matched.name,
    categoryCode: matched.categoryCode as CategoryCode,
    fieldNo: matched.fieldNo,
    at: Date.now(),
  };
  await session.save();

  revalidatePath("/hakam");
  return { ok: true };
}

export async function judgeLogout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  revalidatePath("/hakam");
}

/** Hakam shu o'yinga tegishlimi? Har yozuvdan oldin tekshiriladi. */
async function loadOwnedMatch(tx: Tx, matchId: number, judge: { categoryCode: string }) {
  const [match] = await tx
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .for("update");

  if (!match) throw new Error("Oʻyin topilmadi");
  if (match.categoryCode !== judge.categoryCode) {
    throw new Error("Bu oʻyin sizning yoʻnalishingizga tegishli emas");
  }
  return match;
}

/* ============================================================
   Robofutbol — hisob
   ============================================================ */

export async function saveFootballResult(
  rawMatchId: unknown,
  rawScoreA: unknown,
  rawScoreB: unknown,
): Promise<ActionResult> {
  const judge = await requireJudge().catch(() => null);
  if (!judge) return { ok: false, error: "Qayta kiring" };

  const matchId = toId(rawMatchId);
  if (matchId === null) return { ok: false, error: "Oʻyin topilmadi" };

  const scoreA = toInt(rawScoreA, { min: 0, max: 99 });
  const scoreB = toInt(rawScoreB, { min: 0, max: 99 });
  if (scoreA === null || scoreB === null) {
    return { ok: false, error: "Hisob 0–99 oraligʻida butun son boʻlsin" };
  }

  try {
    await db.transaction(async (tx) => {
      const match = await loadOwnedMatch(tx, matchId, judge);
      const winnerId =
        scoreA > scoreB ? match.teamAId : scoreB > scoreA ? match.teamBId : null;

      await tx
        .update(schema.matches)
        .set({
          scoreA,
          scoreB,
          winnerId,
          status: "done",
          finishedAt: new Date(),
          judgeId: judge.id,
        })
        .where(eq(schema.matches.id, matchId));

      if (match.stage === "playoff") await advanceWinner(tx, matchId, winnerId);

      await tx.insert(schema.auditLog).values({
        actor: judge.name,
        action: "match.result",
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

      // Keyingi tur avtomatik ochiladi (guruh tugasa — pleyoff tuziladi)
      await advanceCategory(tx, match.categoryCode as CategoryCode, "tizim");
    });

    revalidateJudgeViews(judge.categoryCode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Sumo — 3 tadan 2 (best of 3)
   ============================================================ */

type SumoRounds = { rounds: { n: number; winner: "a" | "b" }[] };

export async function saveSumoRound(
  rawMatchId: unknown,
  side: "a" | "b",
): Promise<ActionResult<{ finished: boolean; winsA: number; winsB: number }>> {
  const judge = await requireJudge().catch(() => null);
  if (!judge) return { ok: false, error: "Qayta kiring" };
  if (side !== "a" && side !== "b") return { ok: false, error: "Notoʻgʻri tomon" };

  const matchId = toId(rawMatchId);
  if (matchId === null) return { ok: false, error: "Oʻyin topilmadi" };

  try {
    const outcome = await db.transaction(async (tx) => {
      const match = await loadOwnedMatch(tx, matchId, judge);
      if (match.status === "done") throw new Error("Uchrashuv allaqachon yakunlangan");

      const current = (match.roundsJson as SumoRounds | null) ?? { rounds: [] };
      const rounds = [...current.rounds, { n: current.rounds.length + 1, winner: side }];

      const winsA = rounds.filter((r) => r.winner === "a").length;
      const winsB = rounds.filter((r) => r.winner === "b").length;

      // 2-g'alabada uchrashuv avtomatik yopiladi
      const finished = winsA === 2 || winsB === 2;
      const winnerId = finished ? (winsA === 2 ? match.teamAId : match.teamBId) : null;

      await tx
        .update(schema.matches)
        .set({
          roundsJson: { rounds },
          scoreA: winsA,
          scoreB: winsB,
          status: finished ? "done" : "live",
          winnerId,
          startedAt: match.startedAt ?? new Date(),
          finishedAt: finished ? new Date() : null,
          judgeId: judge.id,
        })
        .where(eq(schema.matches.id, matchId));

      if (finished) await advanceWinner(tx, matchId, winnerId);

      await tx.insert(schema.auditLog).values({
        actor: judge.name,
        action: "match.sumo_round",
        entity: "match",
        entityId: String(matchId),
        before: current,
        after: { rounds, finished },
      });

      await emit(tx, match.categoryCode, "match.updated", {
        matchId,
        scoreA: winsA,
        scoreB: winsB,
        winnerId,
        status: finished ? "done" : "live",
        rounds,
      });

      if (finished) {
        await advanceCategory(tx, match.categoryCode as CategoryCode, "tizim");
      }

      return { finished, winsA, winsB };
    });

    revalidateJudgeViews(judge.categoryCode);
    return { ok: true, data: outcome };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Robrace — bitta raund, ixtiyoriy vaqt
   ============================================================ */

export async function saveRaceResult(
  rawMatchId: unknown,
  side: "a" | "b",
  rawTimeA: unknown,
  rawTimeB: unknown,
): Promise<ActionResult> {
  const judge = await requireJudge().catch(() => null);
  if (!judge) return { ok: false, error: "Qayta kiring" };
  if (side !== "a" && side !== "b") return { ok: false, error: "Notoʻgʻri tomon" };

  const matchId = toId(rawMatchId);
  if (matchId === null) return { ok: false, error: "Oʻyin topilmadi" };

  // Vaqt ixtiyoriy: null qolishi mumkin, lekin kelgan boʻlsa haqiqiy son boʻlsin
  const timeAMs = rawTimeA === null || rawTimeA === undefined
    ? null
    : toInt(rawTimeA, { min: 0, max: 3_600_000 });
  const timeBMs = rawTimeB === null || rawTimeB === undefined
    ? null
    : toInt(rawTimeB, { min: 0, max: 3_600_000 });

  try {
    await db.transaction(async (tx) => {
      const match = await loadOwnedMatch(tx, matchId, judge);
      const winnerId = side === "a" ? match.teamAId : match.teamBId;

      await tx
        .update(schema.matches)
        .set({
          winnerId,
          scoreA: side === "a" ? 1 : 0,
          scoreB: side === "b" ? 1 : 0,
          roundsJson: { timeAMs, timeBMs },
          status: "done",
          finishedAt: new Date(),
          judgeId: judge.id,
        })
        .where(eq(schema.matches.id, matchId));

      await advanceWinner(tx, matchId, winnerId);

      await tx.insert(schema.auditLog).values({
        actor: judge.name,
        action: "match.race",
        entity: "match",
        entityId: String(matchId),
        after: { winnerId, timeAMs, timeBMs },
      });

      await emit(tx, match.categoryCode, "match.updated", {
        matchId,
        scoreA: side === "a" ? 1 : 0,
        scoreB: side === "b" ? 1 : 0,
        winnerId,
        status: "done",
        timeAMs,
        timeBMs,
      });

      await advanceCategory(tx, match.categoryCode as CategoryCode, "tizim");
    });

    revalidateJudgeViews(judge.categoryCode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Linefollower — urinish
   ============================================================ */

export async function saveRun(
  rawTeamId: unknown,
  rawAttemptNo: unknown,
  rawTimeMs: unknown,
  rawPenalties: unknown,
  status: "ok" | "dnf",
): Promise<ActionResult<{ finalMs: number }>> {
  const judge = await requireJudge().catch(() => null);
  if (!judge) return { ok: false, error: "Qayta kiring" };
  if (status !== "ok" && status !== "dnf") return { ok: false, error: "Notoʻgʻri holat" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Jamoa topilmadi" };

  const attemptNo = toInt(rawAttemptNo, { min: 1, max: 2 });
  if (attemptNo === null) {
    return { ok: false, error: "Urinish raqami 1 yoki 2 boʻlishi kerak" };
  }

  const penalties = toInt(rawPenalties, { min: 0, max: 99 }) ?? 0;

  // 1 soatdan uzun urinish — kiritishda xato, bazaga tushmasin
  const timeMs = toInt(rawTimeMs, { min: 0, max: 3_600_000 });
  if (status === "ok" && (timeMs === null || timeMs <= 0)) {
    return { ok: false, error: "Vaqt kiritilmagan yoki notoʻgʻri" };
  }

  const finalMs = status === "dnf" ? 0 : (timeMs ?? 0) + penalties * PENALTY_MS;
  const rawMs = status === "dnf" ? 0 : (timeMs ?? 0);

  try {
    await db.transaction(async (tx) => {
      const [team] = await tx
        .select({ id: schema.teams.id, categoryCode: schema.teams.categoryCode })
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId));

      if (!team) throw new Error("Jamoa topilmadi");
      if (team.categoryCode !== judge.categoryCode) {
        throw new Error("Bu jamoa sizning yoʻnalishingizga tegishli emas");
      }

      // Qayta yozish mumkin (xato kiritilgan bo'lsa) — lekin audit qoladi
      await tx
        .insert(schema.runs)
        .values({
          teamId,
          attemptNo,
          rawMs,
          penalties,
          finalMs,
          status,
          judgeId: judge.id,
        })
        .onConflictDoUpdate({
          target: [schema.runs.teamId, schema.runs.attemptNo],
          set: {
            rawMs,
            penalties,
            finalMs,
            status,
            judgeId: judge.id,
            createdAt: new Date(),
          },
        });

      await tx.insert(schema.auditLog).values({
        actor: judge.name,
        action: "run.save",
        entity: "team",
        entityId: String(teamId),
        after: { attemptNo, rawMs, penalties, finalMs, status },
      });

      await emit(tx, team.categoryCode, "run.saved", {
        teamId,
        attemptNo,
        rawMs,
        penalties,
        finalMs,
        status,
      });
    });

    revalidateJudgeViews(judge.categoryCode);
    return { ok: true, data: { finalMs } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Bekor qilish — 10 soniya ichida xato bosilganini qaytarish
   ============================================================ */

export async function revertMatch(rawMatchId: unknown): Promise<ActionResult> {
  const judge = await requireJudge().catch(() => null);
  if (!judge) return { ok: false, error: "Qayta kiring" };

  const matchId = toId(rawMatchId);
  if (matchId === null) return { ok: false, error: "Oʻyin topilmadi" };

  try {
    await db.transaction(async (tx) => {
      const match = await loadOwnedMatch(tx, matchId, judge);

      // Keyingi bosqich boshlangan bo'lsa qaytarib bo'lmaydi
      if (match.nextMatchId) {
        const [next] = await tx
          .select({ status: schema.matches.status })
          .from(schema.matches)
          .where(eq(schema.matches.id, match.nextMatchId));
        if (next && next.status !== "pending") {
          throw new Error("Keyingi bosqich boshlangan — bekor qilib boʻlmaydi");
        }
        // G'olibni keyingi o'yindan olib tashlaymiz
        await tx
          .update(schema.matches)
          .set(match.nextSlot === "a" ? { teamAId: null } : { teamBId: null })
          .where(eq(schema.matches.id, match.nextMatchId));
      }

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
        actor: judge.name,
        action: "match.revert",
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
    });

    revalidateJudgeViews(judge.categoryCode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function revertRun(
  rawTeamId: unknown,
  rawAttemptNo: unknown,
): Promise<ActionResult> {
  const judge = await requireJudge().catch(() => null);
  if (!judge) return { ok: false, error: "Qayta kiring" };

  const teamId = toId(rawTeamId);
  const attemptNo = toInt(rawAttemptNo, { min: 1, max: 2 });
  if (teamId === null || attemptNo === null) {
    return { ok: false, error: "Notoʻgʻri urinish" };
  }

  try {
    await db.transaction(async (tx) => {
      const [team] = await tx
        .select({ categoryCode: schema.teams.categoryCode })
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId));
      if (!team || team.categoryCode !== judge.categoryCode) {
        throw new Error("Ruxsat yoʻq");
      }

      await tx
        .delete(schema.runs)
        .where(and(eq(schema.runs.teamId, teamId), eq(schema.runs.attemptNo, attemptNo)));

      await tx.insert(schema.auditLog).values({
        actor: judge.name,
        action: "run.revert",
        entity: "team",
        entityId: String(teamId),
        before: { attemptNo },
      });

      await emit(tx, team.categoryCode, "run.reverted", { teamId, attemptNo });
    });

    revalidateJudgeViews(judge.categoryCode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function revalidateJudgeViews(categoryCode: string) {
  revalidatePath("/hakam");
  const slug = CATEGORIES[categoryCode as CategoryCode]?.slug;
  if (slug) revalidatePath(`/jonli/${slug}`);
  revalidatePath("/"); // jonli tablo indeksi bosh sahifada
}
