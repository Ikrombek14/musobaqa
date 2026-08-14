import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentEventId } from "@/lib/realtime/bus";
import type { CategoryCode } from "@/lib/categories";
import { normalizeSearch } from "@/lib/format";

export type BoardTeam = {
  id: number;
  name: string;
  number: string | null;
  school: string | null;
  region: string | null;
  /**
   * Jamoadagi bolalar ismi.
   *
   * Robofutbolda jamoa ikki kishilik, jamoa nomi esa birinchi bolaning
   * ismi. Ikkinchi bolaning ota-onasi tabloda farzandini topa olmasdi —
   * shuning uchun tarkib toʻliq koʻrsatiladi.
   */
  members: string | null;
};

export type BoardMatch = {
  id: number;
  stage: string;
  groupId: number | null;
  round: number;
  slot: number;
  fieldNo: number | null;
  teamAId: number | null;
  teamBId: number | null;
  scoreA: number;
  scoreB: number;
  winnerId: number | null;
  status: string;
  isBye: boolean;
  roundsJson: unknown;
};

export type BoardRun = {
  teamId: number;
  attemptNo: number;
  rawMs: number;
  penalties: number;
  finalMs: number;
  status: string;
};

export type BoardData = {
  categoryCode: CategoryCode;
  drawLocked: boolean;
  /** Guruhdan nechta jamoa pleyoffga chiqadi — jadvalda ajratib koʻrsatiladi */
  advancePerGroup: number;
  teams: BoardTeam[];
  matches: BoardMatch[];
  groups: { id: number; name: string; fieldNo: number | null; teamIds: number[] }[];
  runs: BoardRun[];
  startOrder: number[];
  /** SSE shu id'dan keyingi hodisalarni beradi — bo'shliq qolmaydi */
  sinceId: number;
};

/**
 * Tablo uchun butun holat — bitta funksiya.
 *
 * So'rovlar parallel ketadi (Promise.all): ketma-ket `await` sahifa
 * sekinligining eng ko'p uchraydigan sababi.
 *
 * `sinceId` ENG OXIRIDA olinadi: sahifa render bo'lgunicha yozilgan
 * natija ham mijozga SSE orqali yetib boradi.
 */
export const getBoardData = cache(async (categoryCode: CategoryCode): Promise<BoardData> => {
  const [settings, teams, matches, groupRows, runs, latestDraw] = await Promise.all([
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
        id: schema.teams.id,
        name: schema.teams.name,
        number: schema.teams.number,
        school: schema.teams.school,
        region: schema.teams.region,
        members: sql<string | null>`(
          select string_agg(p.full_name, ', ' order by p.id)
          from participants p where p.team_id = ${schema.teams.id}
        )`,
      })
      .from(schema.teams)
      .where(
        and(eq(schema.teams.categoryCode, categoryCode), isNotNull(schema.teams.checkedInAt)),
      )
      .orderBy(asc(schema.teams.numberSeq)),

    db
      .select({
        id: schema.matches.id,
        stage: schema.matches.stage,
        groupId: schema.matches.groupId,
        round: schema.matches.round,
        slot: schema.matches.slot,
        fieldNo: schema.matches.fieldNo,
        teamAId: schema.matches.teamAId,
        teamBId: schema.matches.teamBId,
        scoreA: schema.matches.scoreA,
        scoreB: schema.matches.scoreB,
        winnerId: schema.matches.winnerId,
        status: schema.matches.status,
        isBye: schema.matches.isBye,
        roundsJson: schema.matches.roundsJson,
      })
      .from(schema.matches)
      .where(eq(schema.matches.categoryCode, categoryCode))
      .orderBy(asc(schema.matches.round), asc(schema.matches.slot)),

    db
      .select({
        groupId: schema.groups.id,
        groupName: schema.groups.name,
        groupField: schema.groups.fieldNo,
        teamId: schema.groupTeams.teamId,
        position: schema.groupTeams.position,
      })
      .from(schema.groups)
      .leftJoin(schema.groupTeams, eq(schema.groupTeams.groupId, schema.groups.id))
      .where(eq(schema.groups.categoryCode, categoryCode))
      .orderBy(asc(schema.groups.name), asc(schema.groupTeams.position)),

    db
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
      .where(eq(schema.teams.categoryCode, categoryCode)),

    db
      .select({ resultJson: schema.draws.resultJson })
      .from(schema.draws)
      .where(
        and(
          eq(schema.draws.categoryCode, categoryCode),
          sql`${schema.draws.cancelledAt} is null`,
        ),
      )
      .orderBy(desc(schema.draws.createdAt))
      .limit(1)
      .then((r) => r[0]),
  ]);

  const groupMap = new Map<
    number,
    { id: number; name: string; fieldNo: number | null; teamIds: number[] }
  >();
  for (const row of groupRows) {
    const entry = groupMap.get(row.groupId) ?? {
      id: row.groupId,
      name: row.groupName,
      fieldNo: row.groupField,
      teamIds: [],
    };
    if (row.teamId !== null) entry.teamIds.push(row.teamId);
    groupMap.set(row.groupId, entry);
  }

  const startOrder =
    (latestDraw?.resultJson as { startOrder?: number[] } | undefined)?.startOrder ?? [];

  return {
    categoryCode,
    drawLocked: settings?.drawLocked ?? false,
    advancePerGroup: settings?.advancePerGroup ?? 1,
    teams,
    matches,
    groups: [...groupMap.values()],
    runs,
    startOrder,
    sinceId: await currentEventId(),
  };
});

/* ============================================================
   Check-in qidiruvi
   ============================================================ */

export type SearchHit = {
  id: number;
  name: string;
  number: string | null;
  categoryCode: string;
  school: string | null;
  region: string | null;
  coach: string | null;
  checkedInAt: Date | null;
  members: string | null;
};

/**
 * Fuzzy qidiruv — 2 harfdan ishlaydi.
 * pg_trgm o'xshashligi bo'yicha tartiblaydi, ya'ni "robotex" yozilganda
 * "Robotexniklar" birinchi chiqadi. Apostrof va katta harf ahamiyatsiz.
 */
export async function searchTeams(query: string, limit = 12): Promise<SearchHit[]> {
  const normalized = normalizeSearch(query);
  if (normalized.length < 2) return [];

  const { rows } = await db.execute<SearchHit>(sql`
    select
      t.id,
      t.name,
      t.number,
      t.category_code    as "categoryCode",
      t.school,
      t.region,
      t.coach,
      t.checked_in_at    as "checkedInAt",
      (select string_agg(p.full_name, ', ' order by p.id)
         from participants p where p.team_id = t.id) as members
    from teams t
    where t.search_text ilike ${"%" + normalized + "%"}
       or similarity(t.search_text, ${normalized}) > 0.2
    order by
      (t.search_text ilike ${normalized + "%"}) desc,
      similarity(t.search_text, ${normalized}) desc,
      t.name
    limit ${limit}
  `);

  return rows;
}

/* ============================================================
   Umumiy holat — bosh sahifa va admin uchun
   ============================================================ */

export const getOverview = cache(async () => {
  const rows = await db
    .select({
      code: schema.categories.code,
      name: schema.categories.name,
      drawLocked: schema.categories.drawLocked,
      groupSize: schema.categories.groupSize,
      matchMinutes: schema.categories.matchMinutes,
      advancePerGroup: schema.categories.advancePerGroup,
      fieldCount: schema.categories.fieldCount,
      total: sql<number>`count(${schema.teams.id})::int`,
      checkedIn: sql<number>`count(${schema.teams.checkedInAt})::int`,
    })
    .from(schema.categories)
    .leftJoin(schema.teams, eq(schema.teams.categoryCode, schema.categories.code))
    .groupBy(
      schema.categories.code,
      schema.categories.name,
      schema.categories.drawLocked,
      schema.categories.groupSize,
      schema.categories.matchMinutes,
      schema.categories.advancePerGroup,
      schema.categories.fieldCount,
    );

  const done = await db
    .select({
      code: schema.matches.categoryCode,
      played: sql<number>`count(*) filter (where ${schema.matches.status} = 'done')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.matches)
    .groupBy(schema.matches.categoryCode);

  const playedBy = new Map(done.map((d) => [d.code, d]));

  return rows.map((row) => ({
    ...row,
    matchesPlayed: playedBy.get(row.code)?.played ?? 0,
    matchesTotal: playedBy.get(row.code)?.total ?? 0,
  }));
});
