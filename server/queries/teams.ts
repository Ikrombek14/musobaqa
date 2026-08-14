import "server-only";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { currentEventId } from "@/lib/realtime/bus";
import { normalizeSearch } from "@/lib/format";
import { roundName } from "@/lib/draw/engine";
import type { CategoryCode } from "@/lib/categories";

export type AdminTeam = {
  id: number;
  number: string | null;
  name: string;
  categoryCode: string;
  school: string | null;
  region: string | null;
  coach: string | null;
  phone: string | null;
  checkedInAt: Date | null;
  checkedInBy: string | null;
  walkIn: boolean;
  members: string | null;
  memberCount: number;
  groupName: string | null;
  photoPath: string | null;
};

export type TeamFilters = {
  category?: CategoryCode | "all";
  status?: "all" | "checked" | "waiting";
  query?: string;
};

/**
 * Admin uchun to'liq jamoalar ro'yxati.
 *
 * Ishtirokchilar, guruh va surat bitta so'rovda keladi — 400 ta jamoa
 * uchun ham bu bitta marta bazaga borish, N+1 yo'q.
 */
export async function listTeamsAdmin(filters: TeamFilters = {}): Promise<AdminTeam[]> {
  const conditions = [];

  if (filters.category && filters.category !== "all") {
    conditions.push(eq(schema.teams.categoryCode, filters.category));
  }
  if (filters.status === "checked") {
    conditions.push(isNotNull(schema.teams.checkedInAt));
  } else if (filters.status === "waiting") {
    conditions.push(isNull(schema.teams.checkedInAt));
  }

  const search = normalizeSearch(filters.query ?? "");
  if (search.length >= 2) {
    conditions.push(sql`${schema.teams.searchText} ilike ${"%" + search + "%"}`);
  }

  const rows = await db
    .select({
      id: schema.teams.id,
      number: schema.teams.number,
      numberSeq: schema.teams.numberSeq,
      name: schema.teams.name,
      categoryCode: schema.teams.categoryCode,
      school: schema.teams.school,
      region: schema.teams.region,
      coach: schema.teams.coach,
      phone: schema.teams.phone,
      checkedInAt: schema.teams.checkedInAt,
      checkedInBy: schema.teams.checkedInBy,
      walkIn: schema.teams.walkIn,
      groupName: schema.groups.name,
      members: sql<string | null>`(
        select string_agg(p.full_name, ', ' order by p.id)
        from participants p where p.team_id = ${schema.teams.id}
      )`,
      memberCount: sql<number>`(
        select count(*)::int from participants p where p.team_id = ${schema.teams.id}
      )`,
      photoPath: sql<string | null>`(
        select r.photo_path from robots r
        where r.team_id = ${schema.teams.id}
        order by r.captured_at desc limit 1
      )`,
    })
    .from(schema.teams)
    .leftJoin(schema.groupTeams, eq(schema.groupTeams.teamId, schema.teams.id))
    .leftJoin(schema.groups, eq(schema.groups.id, schema.groupTeams.groupId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(schema.teams.categoryCode), asc(schema.teams.numberSeq), asc(schema.teams.name));

  return rows.map(({ numberSeq: _numberSeq, ...rest }) => rest);
}

/* ============================================================
   Kim bilan kim — juftliklar
   ============================================================ */

export type PairRow = {
  matchId: number;
  stage: string;
  roundLabel: string;
  groupName: string | null;
  fieldNo: number | null;
  status: string;
  a: { id: number; name: string; number: string | null; school: string | null } | null;
  b: { id: number; name: string; number: string | null; school: string | null } | null;
  scoreA: number;
  scoreB: number;
  winnerId: number | null;
};

export type GroupComposition = {
  id: number;
  name: string;
  fieldNo: number | null;
  teams: { id: number; name: string; number: string | null; school: string | null }[];
};

export type PairingsData = {
  categoryCode: CategoryCode;
  drawLocked: boolean;
  /** Guruhdan nechta jamoa chiqadi — jadvalda ajratib koʻrsatiladi */
  advancePerGroup: number;
  groups: GroupComposition[];
  pairs: PairRow[];
  totalRounds: number;
  startOrder: { id: number; name: string; number: string | null }[];
  sinceId: number;
};

export async function getPairings(categoryCode: CategoryCode): Promise<PairingsData> {
  const teamA = alias(schema.teams, "pa");
  const teamB = alias(schema.teams, "pb");

  const [settings, matchRows, groupRows, order] = await Promise.all([
    db
      .select({
        drawLocked: schema.categories.drawLocked,
        advancePerGroup: schema.categories.advancePerGroup,
      })
      .from(schema.categories)
      .where(eq(schema.categories.code, categoryCode))
      .then((r) => r[0]),

    db
      .select({
        matchId: schema.matches.id,
        stage: schema.matches.stage,
        round: schema.matches.round,
        slot: schema.matches.slot,
        fieldNo: schema.matches.fieldNo,
        status: schema.matches.status,
        scoreA: schema.matches.scoreA,
        scoreB: schema.matches.scoreB,
        winnerId: schema.matches.winnerId,
        isBye: schema.matches.isBye,
        thirdPlace: schema.matches.thirdPlace,
        groupName: schema.groups.name,
        aId: teamA.id,
        aName: teamA.name,
        aNumber: teamA.number,
        aSchool: teamA.school,
        bId: teamB.id,
        bName: teamB.name,
        bNumber: teamB.number,
        bSchool: teamB.school,
      })
      .from(schema.matches)
      .leftJoin(schema.groups, eq(schema.groups.id, schema.matches.groupId))
      .leftJoin(teamA, eq(teamA.id, schema.matches.teamAId))
      .leftJoin(teamB, eq(teamB.id, schema.matches.teamBId))
      .where(eq(schema.matches.categoryCode, categoryCode))
      .orderBy(
        asc(schema.matches.stage),
        asc(schema.matches.round),
        asc(schema.matches.slot),
      ),

    db
      .select({
        id: schema.groups.id,
        name: schema.groups.name,
        fieldNo: schema.groups.fieldNo,
        teamId: schema.teams.id,
        teamName: schema.teams.name,
        teamNumber: schema.teams.number,
        teamSchool: schema.teams.school,
        position: schema.groupTeams.position,
      })
      .from(schema.groups)
      .leftJoin(schema.groupTeams, eq(schema.groupTeams.groupId, schema.groups.id))
      .leftJoin(schema.teams, eq(schema.teams.id, schema.groupTeams.teamId))
      .where(eq(schema.groups.categoryCode, categoryCode))
      .orderBy(asc(schema.groups.name), asc(schema.groupTeams.position)),

    db
      .select({
        id: schema.teams.id,
        name: schema.teams.name,
        number: schema.teams.number,
      })
      .from(schema.teams)
      .where(
        and(
          eq(schema.teams.categoryCode, categoryCode),
          isNotNull(schema.teams.checkedInAt),
        ),
      )
      .orderBy(asc(schema.teams.numberSeq)),
  ]);

  const groupMap = new Map<number, GroupComposition>();
  for (const row of groupRows) {
    const entry = groupMap.get(row.id) ?? {
      id: row.id,
      name: row.name,
      fieldNo: row.fieldNo,
      teams: [],
    };
    if (row.teamId !== null) {
      entry.teams.push({
        id: row.teamId,
        name: row.teamName!,
        number: row.teamNumber,
        school: row.teamSchool,
      });
    }
    groupMap.set(row.id, entry);
  }

  const playoffRounds = matchRows.filter((m) => m.stage === "playoff");
  const totalRounds = playoffRounds.length
    ? Math.max(...playoffRounds.map((m) => m.round))
    : 0;

  const pairs: PairRow[] = matchRows.map((row) => ({
    matchId: row.matchId,
    stage: row.stage,
    roundLabel:
      row.stage === "group"
        ? `${row.round}-tur`
        : row.thirdPlace
          ? "3-oʻrin uchun"
          : row.isBye
            ? "Raqibsiz"
            : playoffRoundLabel(row.round, totalRounds),
    groupName: row.groupName,
    fieldNo: row.fieldNo,
    status: row.isBye ? "bye" : row.status,
    a: row.aId
      ? { id: row.aId, name: row.aName!, number: row.aNumber, school: row.aSchool }
      : null,
    b: row.bId
      ? { id: row.bId, name: row.bName!, number: row.bNumber, school: row.bSchool }
      : null,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    winnerId: row.winnerId,
  }));

  return {
    categoryCode,
    drawLocked: settings?.drawLocked ?? false,
    advancePerGroup: settings?.advancePerGroup ?? 1,
    groups: [...groupMap.values()],
    pairs,
    totalRounds,
    startOrder: order,
    sinceId: await currentEventId(),
  };
}

/** Yagona manba: lib/draw/engine.ts dagi roundName. */
const playoffRoundLabel = roundName;
