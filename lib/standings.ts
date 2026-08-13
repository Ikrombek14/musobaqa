import { POINTS } from "./categories";

/**
 * Reyting hisobi — sof funksiyalar.
 * Tablo har hodisada shu yerdan qayta hisoblaydi: 60–400 jamoa uchun
 * bu mikrosoniyalar ishi, keshlash va uni bekor qilish muammosi yo'q.
 */

export type StandingTeam = { id: number; name: string; number: string | null };

export type StandingMatch = {
  teamAId: number | null;
  teamBId: number | null;
  scoreA: number;
  scoreB: number;
  status: string;
};

export type StandingRow = {
  teamId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  diff: number;
  points: number;
};

/**
 * Guruh jadvali.
 *
 * Teng bo'lsa tartib (TZ 4.1):
 *   ochko → gol farqi → urgan gollar → shaxsiy uchrashuv → raqam
 *
 * Shaxsiy uchrashuv faqat IKKI jamoa teng bo'lganda qo'llanadi — uch va
 * undan ortiq jamoa aylanma teng bo'lsa bu mezon mantiqsiz bo'lib qoladi,
 * shunda keyingi mezonga (raqam) o'tiladi.
 */
export function computeGroupTable(
  teams: readonly StandingTeam[],
  matches: readonly StandingMatch[],
): StandingRow[] {
  const rows = new Map<number, StandingRow>();
  for (const team of teams) {
    rows.set(team.id, {
      teamId: team.id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      diff: 0,
      points: 0,
    });
  }

  const done = matches.filter(
    (m) => m.status === "done" && m.teamAId !== null && m.teamBId !== null,
  );

  for (const match of done) {
    const a = rows.get(match.teamAId!);
    const b = rows.get(match.teamBId!);
    if (!a || !b) continue;

    a.played++;
    b.played++;
    a.goalsFor += match.scoreA;
    a.goalsAgainst += match.scoreB;
    b.goalsFor += match.scoreB;
    b.goalsAgainst += match.scoreA;

    if (match.scoreA > match.scoreB) {
      a.won++;
      b.lost++;
      a.points += POINTS.win;
      b.points += POINTS.loss;
    } else if (match.scoreA < match.scoreB) {
      b.won++;
      a.lost++;
      b.points += POINTS.win;
      a.points += POINTS.loss;
    } else {
      a.drawn++;
      b.drawn++;
      a.points += POINTS.draw;
      b.points += POINTS.draw;
    }
  }

  for (const row of rows.values()) row.diff = row.goalsFor - row.goalsAgainst;

  const list = [...rows.values()];
  const numberOf = new Map(teams.map((t) => [t.id, t.number ?? "￿"]));

  return list.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.diff !== x.diff) return y.diff - x.diff;
    if (y.goalsFor !== x.goalsFor) return y.goalsFor - x.goalsFor;

    const h2h = headToHead(x.teamId, y.teamId, done, list);
    if (h2h !== 0) return h2h;

    return (numberOf.get(x.teamId) ?? "").localeCompare(numberOf.get(y.teamId) ?? "");
  });
}

/**
 * Shaxsiy uchrashuv. Faqat shu ikki jamoa teng ochkoda bo'lsa ishlaydi —
 * uchinchi teng jamoa bo'lsa 0 qaytaradi (aylanma tenglikda noto'g'ri
 * natija bermaslik uchun).
 */
function headToHead(
  aId: number,
  bId: number,
  matches: readonly StandingMatch[],
  all: readonly StandingRow[],
): number {
  const rowA = all.find((r) => r.teamId === aId);
  const rowB = all.find((r) => r.teamId === bId);
  if (!rowA || !rowB) return 0;

  const tiedCount = all.filter(
    (r) => r.points === rowA.points && r.diff === rowA.diff && r.goalsFor === rowA.goalsFor,
  ).length;
  if (tiedCount > 2) return 0;

  let aGoals = 0;
  let bGoals = 0;
  let met = false;
  for (const m of matches) {
    if (m.teamAId === aId && m.teamBId === bId) {
      aGoals += m.scoreA;
      bGoals += m.scoreB;
      met = true;
    } else if (m.teamAId === bId && m.teamBId === aId) {
      aGoals += m.scoreB;
      bGoals += m.scoreA;
      met = true;
    }
  }
  if (!met) return 0;
  return bGoals - aGoals; // ko'p urgan yuqorida
}

/* ============================================================
   Linefollower — vaqt bo'yicha reyting
   ============================================================ */

export type RunRecord = {
  teamId: number;
  attemptNo: number;
  finalMs: number;
  status: string; // ok | dnf
};

export type TimeRankRow = {
  teamId: number;
  bestMs: number | null; // null = ikkala urinish ham DNF yoki urinish yo'q
  attempts: { attemptNo: number; finalMs: number; status: string }[];
  dnfOnly: boolean;
};

/**
 * Eng yaxshi urinish hisobga olinadi. Ikkala urinish ham DNF bo'lsa —
 * reytingda oxirgi o'rin (TZ 4.4). Hali urinmagan jamoa ham pastda,
 * lekin DNF olganlardan keyin emas — u hali imkoniyatini yo'qotmagan.
 */
export function computeTimeRanking(
  teams: readonly StandingTeam[],
  runs: readonly RunRecord[],
): TimeRankRow[] {
  const byTeam = new Map<number, RunRecord[]>();
  for (const run of runs) {
    const list = byTeam.get(run.teamId) ?? [];
    list.push(run);
    byTeam.set(run.teamId, list);
  }

  const rows: TimeRankRow[] = teams.map((team) => {
    const attempts = (byTeam.get(team.id) ?? []).sort((a, b) => a.attemptNo - b.attemptNo);
    const valid = attempts.filter((a) => a.status === "ok");
    const bestMs = valid.length ? Math.min(...valid.map((a) => a.finalMs)) : null;
    return {
      teamId: team.id,
      bestMs,
      attempts: attempts.map((a) => ({
        attemptNo: a.attemptNo,
        finalMs: a.finalMs,
        status: a.status,
      })),
      dnfOnly: attempts.length > 0 && valid.length === 0,
    };
  });

  return rows.sort((x, y) => {
    if (x.bestMs !== null && y.bestMs !== null) return x.bestMs - y.bestMs;
    if (x.bestMs !== null) return -1;
    if (y.bestMs !== null) return 1;
    // Ikkalasi ham vaqtsiz: urinib DNF olgan, urinmaganidan yuqorida
    if (x.dnfOnly !== y.dnfOnly) return x.dnfOnly ? -1 : 1;
    return x.teamId - y.teamId;
  });
}
