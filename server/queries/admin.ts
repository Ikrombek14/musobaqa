import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CategoryCode } from "@/lib/categories";

export type JudgeRow = {
  id: number;
  name: string;
  categoryCode: string;
  fieldNo: number | null;
  active: boolean;
  /** Nechta natija yozgan — oʻchirish mumkinligini shu koʻrsatadi */
  resultCount: number;
};

export async function listJudges(): Promise<JudgeRow[]> {
  const rows = await db
    .select({
      id: schema.judges.id,
      name: schema.judges.name,
      categoryCode: schema.judges.categoryCode,
      fieldNo: schema.judges.fieldNo,
      active: schema.judges.active,
    })
    .from(schema.judges)
    .orderBy(
      asc(schema.judges.categoryCode),
      asc(schema.judges.fieldNo),
      asc(schema.judges.name),
    );

  const [matchCounts, runCounts] = await Promise.all([
    db
      .select({ judgeId: schema.matches.judgeId, count: sql<number>`count(*)::int` })
      .from(schema.matches)
      .groupBy(schema.matches.judgeId),
    db
      .select({ judgeId: schema.runs.judgeId, count: sql<number>`count(*)::int` })
      .from(schema.runs)
      .groupBy(schema.runs.judgeId),
  ]);

  const counts = new Map<number, number>();
  for (const row of [...matchCounts, ...runCounts]) {
    if (row.judgeId === null) continue;
    counts.set(row.judgeId, (counts.get(row.judgeId) ?? 0) + row.count);
  }

  return rows.map((row) => ({ ...row, resultCount: counts.get(row.id) ?? 0 }));
}

export type GroupFieldRow = {
  id: number;
  name: string;
  fieldNo: number | null;
  teamCount: number;
  matchesTotal: number;
  matchesDone: number;
};

/** Guruh → maydon ekranining maʼlumoti. */
export async function listGroupsWithFields(
  categoryCode: CategoryCode,
): Promise<GroupFieldRow[]> {
  const groups = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      fieldNo: schema.groups.fieldNo,
    })
    .from(schema.groups)
    .where(eq(schema.groups.categoryCode, categoryCode))
    .orderBy(asc(schema.groups.name));

  if (groups.length === 0) return [];

  const [teamCounts, matchCounts] = await Promise.all([
    db
      .select({ groupId: schema.groupTeams.groupId, count: sql<number>`count(*)::int` })
      .from(schema.groupTeams)
      .groupBy(schema.groupTeams.groupId),
    db
      .select({
        groupId: schema.matches.groupId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${schema.matches.status} = 'done')::int`,
      })
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.categoryCode, categoryCode),
          eq(schema.matches.stage, "group"),
        ),
      )
      .groupBy(schema.matches.groupId),
  ]);

  const teamBy = new Map(teamCounts.map((r) => [r.groupId, r.count]));
  const matchBy = new Map(matchCounts.map((r) => [r.groupId, r]));

  return groups.map((group) => ({
    ...group,
    teamCount: teamBy.get(group.id) ?? 0,
    matchesTotal: matchBy.get(group.id)?.total ?? 0,
    matchesDone: matchBy.get(group.id)?.done ?? 0,
  }));
}

/** Maydonlar boʻyicha joriy yuk — sozlamalar ekranida koʻrsatiladi. */
export async function fieldLoad(categoryCode: CategoryCode) {
  const rows = await db
    .select({
      fieldNo: schema.matches.fieldNo,
      pending: sql<number>`count(*) filter (where ${schema.matches.status} <> 'done')::int`,
      done: sql<number>`count(*) filter (where ${schema.matches.status} = 'done')::int`,
    })
    .from(schema.matches)
    .where(eq(schema.matches.categoryCode, categoryCode))
    .groupBy(schema.matches.fieldNo)
    .orderBy(asc(schema.matches.fieldNo));

  return rows.filter((r) => r.fieldNo !== null) as {
    fieldNo: number;
    pending: number;
    done: number;
  }[];
}
