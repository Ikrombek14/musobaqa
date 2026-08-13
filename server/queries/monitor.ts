import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { currentEventId } from "@/lib/realtime/bus";
import { CATEGORY_CODES, type CategoryCode } from "@/lib/categories";

/* ============================================================
   Boshqaruv markazi — admin real vaqtda hamma narsani ko'radi
   ============================================================ */

export type FieldSlot = {
  categoryCode: string;
  fieldNo: number;
  /** Shu maydonda navbatdagi (yoki ketayotgan) o'yin */
  current: {
    matchId: number;
    stage: string;
    groupName: string | null;
    round: number;
    status: string;
    teamA: string | null;
    numberA: string | null;
    teamB: string | null;
    numberB: string | null;
  } | null;
  waiting: number;
  done: number;
};

export type RecentResult = {
  kind: "match" | "run";
  id: number;
  at: Date;
  categoryCode: string;
  label: string;
  detail: string;
  judge: string | null;
};

export type CategoryPulse = {
  code: CategoryCode;
  teams: number;
  checkedIn: number;
  matchesTotal: number;
  matchesDone: number;
  matchesLive: number;
  runsDone: number;
  runsTotal: number;
  drawLocked: boolean;
  fieldCount: number;
};

export type MonitorData = {
  pulse: CategoryPulse[];
  fields: FieldSlot[];
  recent: RecentResult[];
  judgesOnline: { name: string; categoryCode: string; fieldNo: number | null; active: boolean }[];
  sinceId: number;
};

export async function getMonitorData(): Promise<MonitorData> {
  const teamA = alias(schema.teams, "ma");
  const teamB = alias(schema.teams, "mb");

  const [categories, teamStats, matchStats, runStats, fieldRows, finishedMatches, recentRuns, judges] =
    await Promise.all([
      db
        .select({
          code: schema.categories.code,
          drawLocked: schema.categories.drawLocked,
          fieldCount: schema.categories.fieldCount,
        })
        .from(schema.categories),

      db
        .select({
          code: schema.teams.categoryCode,
          total: sql<number>`count(*)::int`,
          checkedIn: sql<number>`count(${schema.teams.checkedInAt})::int`,
        })
        .from(schema.teams)
        .groupBy(schema.teams.categoryCode),

      db
        .select({
          code: schema.matches.categoryCode,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${schema.matches.status} = 'done')::int`,
          live: sql<number>`count(*) filter (where ${schema.matches.status} = 'live')::int`,
        })
        .from(schema.matches)
        .groupBy(schema.matches.categoryCode),

      db
        .select({
          code: schema.teams.categoryCode,
          done: sql<number>`count(${schema.runs.id})::int`,
          teams: sql<number>`count(distinct ${schema.teams.id})::int`,
        })
        .from(schema.teams)
        .leftJoin(schema.runs, eq(schema.runs.teamId, schema.teams.id))
        .where(isNotNull(schema.teams.checkedInAt))
        .groupBy(schema.teams.categoryCode),

      // Maydonlardagi holat: navbatdagi o'yin + navbat uzunligi
      db
        .select({
          matchId: schema.matches.id,
          categoryCode: schema.matches.categoryCode,
          fieldNo: schema.matches.fieldNo,
          stage: schema.matches.stage,
          round: schema.matches.round,
          orderNo: schema.matches.orderNo,
          slot: schema.matches.slot,
          status: schema.matches.status,
          groupName: schema.groups.name,
          teamAName: teamA.name,
          teamANumber: teamA.number,
          teamBName: teamB.name,
          teamBNumber: teamB.number,
        })
        .from(schema.matches)
        .leftJoin(schema.groups, eq(schema.groups.id, schema.matches.groupId))
        .leftJoin(teamA, eq(teamA.id, schema.matches.teamAId))
        .leftJoin(teamB, eq(teamB.id, schema.matches.teamBId))
        .where(and(isNotNull(schema.matches.fieldNo), eq(schema.matches.isBye, false)))
        .orderBy(
          schema.matches.categoryCode,
          schema.matches.fieldNo,
          schema.matches.round,
          schema.matches.slot,
        ),

      db
        .select({
          id: schema.matches.id,
          at: schema.matches.finishedAt,
          categoryCode: schema.matches.categoryCode,
          scoreA: schema.matches.scoreA,
          scoreB: schema.matches.scoreB,
          stage: schema.matches.stage,
          groupName: schema.groups.name,
          teamAName: teamA.name,
          teamANumber: teamA.number,
          teamBName: teamB.name,
          teamBNumber: teamB.number,
          winnerId: schema.matches.winnerId,
          teamAId: schema.matches.teamAId,
          judgeName: schema.judges.name,
        })
        .from(schema.matches)
        .leftJoin(schema.groups, eq(schema.groups.id, schema.matches.groupId))
        .leftJoin(teamA, eq(teamA.id, schema.matches.teamAId))
        .leftJoin(teamB, eq(teamB.id, schema.matches.teamBId))
        .leftJoin(schema.judges, eq(schema.judges.id, schema.matches.judgeId))
        .where(and(eq(schema.matches.status, "done"), eq(schema.matches.isBye, false)))
        .orderBy(desc(schema.matches.finishedAt))
        .limit(12),

      db
        .select({
          id: schema.runs.id,
          at: schema.runs.createdAt,
          categoryCode: schema.teams.categoryCode,
          teamName: schema.teams.name,
          teamNumber: schema.teams.number,
          attemptNo: schema.runs.attemptNo,
          finalMs: schema.runs.finalMs,
          penalties: schema.runs.penalties,
          status: schema.runs.status,
          judgeName: schema.judges.name,
        })
        .from(schema.runs)
        .innerJoin(schema.teams, eq(schema.teams.id, schema.runs.teamId))
        .leftJoin(schema.judges, eq(schema.judges.id, schema.runs.judgeId))
        .orderBy(desc(schema.runs.createdAt))
        .limit(12),

      db
        .select({
          name: schema.judges.name,
          categoryCode: schema.judges.categoryCode,
          fieldNo: schema.judges.fieldNo,
          active: schema.judges.active,
        })
        .from(schema.judges)
        .orderBy(schema.judges.categoryCode, schema.judges.fieldNo),
    ]);

  const teamBy = new Map(teamStats.map((r) => [r.code, r]));
  const matchBy = new Map(matchStats.map((r) => [r.code, r]));
  const runBy = new Map(runStats.map((r) => [r.code, r]));
  const catBy = new Map(categories.map((r) => [r.code, r]));

  const pulse: CategoryPulse[] = CATEGORY_CODES.map((code) => ({
    code,
    teams: teamBy.get(code)?.total ?? 0,
    checkedIn: teamBy.get(code)?.checkedIn ?? 0,
    matchesTotal: matchBy.get(code)?.total ?? 0,
    matchesDone: matchBy.get(code)?.done ?? 0,
    matchesLive: matchBy.get(code)?.live ?? 0,
    runsDone: runBy.get(code)?.done ?? 0,
    runsTotal: (teamBy.get(code)?.checkedIn ?? 0) * 2,
    drawLocked: catBy.get(code)?.drawLocked ?? false,
    fieldCount: catBy.get(code)?.fieldCount ?? 1,
  }));

  // Maydonlar bo'yicha guruhlash: birinchi tugallanmagan o'yin = "hozir"
  const fieldMap = new Map<string, FieldSlot>();
  for (const row of fieldRows) {
    const key = `${row.categoryCode}:${row.fieldNo}`;
    const slot =
      fieldMap.get(key) ??
      ({
        categoryCode: row.categoryCode,
        fieldNo: row.fieldNo!,
        current: null,
        waiting: 0,
        done: 0,
      } satisfies FieldSlot);

    if (row.status === "done") {
      slot.done++;
    } else {
      // Ketayotgan o'yin har doim navbatdagidan ustun
      const better =
        slot.current === null ||
        (row.status === "live" && slot.current.status !== "live");
      if (better) {
        if (slot.current !== null) slot.waiting++;
        slot.current = {
          matchId: row.matchId,
          stage: row.stage,
          groupName: row.groupName,
          round: row.round,
          status: row.status,
          teamA: row.teamAName,
          numberA: row.teamANumber,
          teamB: row.teamBName,
          numberB: row.teamBNumber,
        };
      } else {
        slot.waiting++;
      }
    }
    fieldMap.set(key, slot);
  }

  const recent: RecentResult[] = [
    ...finishedMatches
      .filter((m) => m.at !== null)
      .map((m) => ({
        kind: "match" as const,
        id: m.id,
        at: m.at!,
        categoryCode: m.categoryCode,
        label:
          `${m.teamANumber ?? "?"} ${m.scoreA}:${m.scoreB} ${m.teamBNumber ?? "?"}` +
          (m.winnerId === null ? " (durang)" : ""),
        detail:
          (m.stage === "group" ? `${m.groupName ?? "?"} guruh · ` : "Pleyoff · ") +
          `${m.teamAName ?? "—"} — ${m.teamBName ?? "—"}`,
        judge: m.judgeName,
      })),
    ...recentRuns.map((r) => ({
      kind: "run" as const,
      id: r.id,
      at: r.at,
      categoryCode: r.categoryCode,
      label: `${r.teamNumber ?? "?"} · ${r.attemptNo}-urinish`,
      detail:
        r.status === "dnf"
          ? `${r.teamName} — DNF`
          : `${r.teamName} — ${(r.finalMs / 1000).toFixed(2)} s` +
            (r.penalties > 0 ? ` (${r.penalties} jarima)` : ""),
      judge: r.judgeName,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 15);

  return {
    pulse,
    fields: [...fieldMap.values()].sort(
      (a, b) => a.categoryCode.localeCompare(b.categoryCode) || a.fieldNo - b.fieldNo,
    ),
    recent,
    judgesOnline: judges,
    sinceId: await currentEventId(),
  };
}
