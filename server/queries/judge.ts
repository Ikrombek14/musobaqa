import "server-only";
import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { currentEventId } from "@/lib/realtime/bus";
import type { Session } from "@/lib/auth/session";

export type JudgeMatch = {
  id: number;
  stage: string;
  round: number;
  fieldNo: number | null;
  status: string;
  scoreA: number;
  scoreB: number;
  winnerId: number | null;
  thirdPlace: boolean;
  roundsJson: unknown;
  groupName: string | null;
  teamA: { id: number; name: string; number: string | null } | null;
  teamB: { id: number; name: string; number: string | null } | null;
};

export type JudgeTeamRun = {
  teamId: number;
  name: string;
  number: string | null;
  attempts: { attemptNo: number; rawMs: number; penalties: number; finalMs: number; status: string }[];
};

export type JudgeWork = {
  matches: JudgeMatch[];
  teams: JudgeTeamRun[];
  totalRounds: number;
  sinceId: number;
};

/**
 * Hakam faqat O'Z maydonining o'yinlarini ko'radi.
 * Maydon biriktirilmagan bo'lsa — yo'nalishning hammasi.
 */
export async function getJudgeWork(judge: NonNullable<Session["judge"]>): Promise<JudgeWork> {
  const teamA = alias(schema.teams, "team_a");
  const teamB = alias(schema.teams, "team_b");

  const matchRows = await db
    .select({
      id: schema.matches.id,
      stage: schema.matches.stage,
      round: schema.matches.round,
      slot: schema.matches.slot,
      fieldNo: schema.matches.fieldNo,
      status: schema.matches.status,
      scoreA: schema.matches.scoreA,
      scoreB: schema.matches.scoreB,
      winnerId: schema.matches.winnerId,
      thirdPlace: schema.matches.thirdPlace,
      roundsJson: schema.matches.roundsJson,
      groupName: schema.groups.name,
      aId: teamA.id,
      aName: teamA.name,
      aNumber: teamA.number,
      bId: teamB.id,
      bName: teamB.name,
      bNumber: teamB.number,
    })
    .from(schema.matches)
    .leftJoin(teamA, eq(teamA.id, schema.matches.teamAId))
    .leftJoin(teamB, eq(teamB.id, schema.matches.teamBId))
    .leftJoin(schema.groups, eq(schema.groups.id, schema.matches.groupId))
    .where(
      and(
        eq(schema.matches.categoryCode, judge.categoryCode),
        eq(schema.matches.isBye, false),
        judge.fieldNo === null
          ? undefined
          : or(
              eq(schema.matches.fieldNo, judge.fieldNo),
              // Keyingi bosqich o'yinlariga maydon hali biriktirilmagan —
              // ular yo'nalishning hamma hakamiga ko'rinadi, aks holda
              // yarim final va final hech kimning ekranida chiqmay qoladi.
              isNull(schema.matches.fieldNo),
            ),
      ),
    )
    .orderBy(asc(schema.matches.round), asc(schema.matches.slot));

  const matches: JudgeMatch[] = matchRows.map((row) => ({
    id: row.id,
    stage: row.stage,
    round: row.round,
    fieldNo: row.fieldNo,
    status: row.status,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    winnerId: row.winnerId,
    thirdPlace: row.thirdPlace,
    roundsJson: row.roundsJson,
    groupName: row.groupName,
    teamA: row.aId ? { id: row.aId, name: row.aName!, number: row.aNumber } : null,
    teamB: row.bId ? { id: row.bId, name: row.bName!, number: row.bNumber } : null,
  }));

  const totalRounds = matches.reduce((max, m) => Math.max(max, m.round), 0);

  // Linefollower — jamoalar va urinishlari
  const teamRows = await db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      number: schema.teams.number,
      numberSeq: schema.teams.numberSeq,
    })
    .from(schema.teams)
    .where(
      and(
        eq(schema.teams.categoryCode, judge.categoryCode),
        isNotNull(schema.teams.checkedInAt),
      ),
    )
    .orderBy(asc(schema.teams.numberSeq));

  const runRows = teamRows.length
    ? await db
        .select({
          teamId: schema.runs.teamId,
          attemptNo: schema.runs.attemptNo,
          rawMs: schema.runs.rawMs,
          penalties: schema.runs.penalties,
          finalMs: schema.runs.finalMs,
          status: schema.runs.status,
        })
        .from(schema.runs)
        .innerJoin(schema.teams, eq(schema.teams.id, schema.runs.teamId))
        .where(eq(schema.teams.categoryCode, judge.categoryCode))
    : [];

  const runsByTeam = new Map<number, JudgeTeamRun["attempts"]>();
  for (const run of runRows) {
    const list = runsByTeam.get(run.teamId) ?? [];
    list.push(run);
    runsByTeam.set(run.teamId, list);
  }

  const teams: JudgeTeamRun[] = teamRows.map((team) => ({
    teamId: team.id,
    name: team.name,
    number: team.number,
    attempts: (runsByTeam.get(team.id) ?? []).sort((a, b) => a.attemptNo - b.attemptNo),
  }));

  return { matches, teams, totalRounds, sinceId: await currentEventId() };
}
