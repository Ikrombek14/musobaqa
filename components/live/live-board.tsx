"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import { Trophy, Timer, Users } from "lucide-react";
import { useLive, type LiveEvent } from "@/lib/realtime/use-live";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import { computeGroupTable, computeTimeRanking } from "@/lib/standings";
import { formatDiff, formatMs } from "@/lib/format";
import { LiveDot, TeamNumber, EmptyState, Card } from "@/components/ui/primitives";
import { roundName } from "@/lib/draw/engine";
import type { BoardData, BoardMatch, BoardRun } from "@/server/queries/competition";

/**
 * Jonli tablo.
 *
 * Server boshlang'ich holatni beradi, keyin SSE faqat O'ZGARISHNI yuboradi.
 * Reyting mijozda qayta hisoblanadi (lib/standings — hakam panelidagi bilan
 * ayni funksiyalar), shuning uchun natija ko'rinishi uchun serverga qayta
 * so'rov ketmaydi: hakam tugmani bosgach tabloda ~50 ms ichida paydo bo'ladi.
 */

type State = { matches: BoardMatch[]; runs: BoardRun[]; flashed: Set<number> };

type Action = LiveEvent | { type: "__sync"; matches: BoardMatch[]; runs: BoardRun[] };

function reducer(state: State, event: Action): State {
  switch (event.type) {
    // Serverdan yangi to'liq holat keldi (tuzilma o'zgargan)
    case "__sync":
      return {
        matches: (event as Extract<Action, { type: "__sync" }>).matches,
        runs: (event as Extract<Action, { type: "__sync" }>).runs,
        flashed: state.flashed,
      };

    case "match.updated":
    case "match.reverted": {
      // Tuzilma hodisasi — bitta o'yin haqida emas, sahifa qayta yuklanadi
      if ((event as LiveEvent).structure === true) return state;

      const id = Number(event.matchId);
      const flashed = new Set(state.flashed);
      flashed.add(id);
      return {
        ...state,
        flashed,
        matches: state.matches.map((m) =>
          m.id === id
            ? {
                ...m,
                scoreA: Number(event.scoreA ?? m.scoreA),
                scoreB: Number(event.scoreB ?? m.scoreB),
                winnerId: (event.winnerId as number | null) ?? null,
                status: String(event.status ?? m.status),
                roundsJson: event.rounds ? { rounds: event.rounds } : m.roundsJson,
              }
            : m,
        ),
      };
    }
    case "run.saved": {
      const teamId = Number(event.teamId);
      const attemptNo = Number(event.attemptNo);
      const next: BoardRun = {
        teamId,
        attemptNo,
        rawMs: Number(event.rawMs),
        penalties: Number(event.penalties),
        finalMs: Number(event.finalMs),
        status: String(event.status),
      };
      const exists = state.runs.some(
        (r) => r.teamId === teamId && r.attemptNo === attemptNo,
      );
      return {
        ...state,
        flashed: new Set(state.flashed).add(teamId),
        runs: exists
          ? state.runs.map((r) =>
              r.teamId === teamId && r.attemptNo === attemptNo ? next : r,
            )
          : [...state.runs, next],
      };
    }
    case "run.reverted": {
      const teamId = Number(event.teamId);
      const attemptNo = Number(event.attemptNo);
      return {
        ...state,
        runs: state.runs.filter(
          (r) => !(r.teamId === teamId && r.attemptNo === attemptNo),
        ),
      };
    }
    default:
      // draw.completed / draw.cancelled — komponentda router.refresh bilan
      return state;
  }
}

export function LiveBoard({ data }: { data: BoardData }) {
  const [state, dispatch] = useReducer(reducer, {
    matches: data.matches,
    runs: data.runs,
    flashed: new Set<number>(),
  });
  const router = useRouter();

  // Server yangi holat yuborganda qabul qilamiz
  useEffect(() => {
    dispatch({ type: "__sync", matches: data.matches, runs: data.runs });
  }, [data.matches, data.runs]);

  /**
   * Tuzilma oʻzgarishi (yangi tur, pleyoff, maydon almashishi) —
   * bitta qatorni patch qilib boʻlmaydi, serverdan yangi holat olamiz.
   * `router.refresh` sahifani qayta yuklamaydi: faqat server komponentini
   * qayta chizadi, shuning uchun TV ekranda miltillash boʻlmaydi.
   */
  const refreshing = useRef(false);
  const status = useLive(data.categoryCode, data.sinceId, (event) => {
    const structural =
      event.structure === true ||
      event.type === "draw.completed" ||
      event.type === "draw.cancelled";

    if (!structural) {
      dispatch(event);
      return;
    }
    if (refreshing.current) return;
    refreshing.current = true;
    router.refresh();
    setTimeout(() => {
      refreshing.current = false;
    }, 800);
  });
  const category = CATEGORIES[data.categoryCode];
  const teamById = useMemo(
    () => new Map(data.teams.map((t) => [t.id, t])),
    [data.teams],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="h-8 w-1.5 rounded-full"
            style={{ backgroundColor: category.colorVar }}
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{category.name}</h1>
          <span className="text-sm text-[var(--text-muted)]">
            {data.teams.length} jamoa
          </span>
        </div>
        <LiveDot status={status} />
      </header>

      {/*
        Linefollower jerebyovkaga bogʻliq emas: jerebyovka faqat start
        tartibini belgilaydi, hakam esa istalgan payt urinish yozishi
        mumkin. Shuning uchun reyting har doim koʻrsatiladi — aks holda
        yozilgan natija tabloda koʻrinmay qolardi.
      */}
      {category.format === "time_trial" ? (
        <TimeView data={data} state={state} teamById={teamById} />
      ) : !data.drawLocked ? (
        <Card>
          <EmptyState
            icon={<Users className="size-8" />}
            title="Jerebyovka hali oʻtkazilmagan"
            hint="Guruhlar va oʻyinlar jadvali jerebyovkadan keyin shu yerda paydo boʻladi."
          />
        </Card>
      ) : category.format === "group_playoff" ? (
        <GroupView data={data} state={state} teamById={teamById} />
      ) : (
        <BracketView data={data} state={state} teamById={teamById} />
      )}
    </div>
  );
}

type ViewProps = {
  data: BoardData;
  state: State;
  teamById: Map<number, BoardData["teams"][number]>;
};

/* ============================================================
   Guruh jadvallari + o'yinlar (robofutbol)
   ============================================================ */
function GroupView({ data, state, teamById }: ViewProps) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {data.groups.map((group) => {
        const teams = group.teamIds
          .map((id) => teamById.get(id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t));
        const matches = state.matches.filter((m) => m.groupId === group.id);
        const table = computeGroupTable(teams, matches);

        return (
          <Card key={group.id} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2.5">
              <h2 className="text-sm font-bold">{group.name} guruh</h2>
              <span className="text-xs text-[var(--text-muted)]">
                {matches.filter((m) => m.status === "done").length}/{matches.length} oʻyin
              </span>
            </div>

            <table className="w-full text-sm">
              <caption className="sr-only">{group.name} guruh jadvali</caption>
              <thead>
                <tr className="text-xs font-semibold text-[var(--text-muted)]">
                  <th scope="col" className="py-2 pl-4 text-left">
                    Jamoa
                  </th>
                  <th scope="col" className="w-8 text-right" title="Oʻynadi">
                    O
                  </th>
                  <th scope="col" className="w-10 text-right" title="Gol farqi">
                    F
                  </th>
                  <th scope="col" className="w-10 pr-4 text-right" title="Ochko">
                    Ochko
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.map((row, index) => {
                  const team = teamById.get(row.teamId);
                  const qualifies = index < 2;
                  return (
                    <tr
                      key={row.teamId}
                      className={
                        "border-t border-[var(--border)] " +
                        (qualifies ? "bg-[var(--success-soft)]" : "")
                      }
                    >
                      <td className="py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <TeamNumber
                            value={team?.number ?? null}
                            category={data.categoryCode}
                            size="sm"
                          />
                          <span className="line-clamp-1 font-medium">{team?.name}</span>
                        </div>
                      </td>
                      <td className="tnum text-right text-[var(--text-muted)]">
                        {row.played}
                      </td>
                      <td className="tnum text-right text-[var(--text-muted)]">
                        {formatDiff(row.diff)}
                      </td>
                      <td className="tnum pr-4 text-right font-bold">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex flex-col gap-1 border-t border-[var(--border)] p-3">
              {matches.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  teamById={teamById}
                  flashed={state.flashed.has(match.id)}
                />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function MatchRow({
  match,
  teamById,
  flashed,
}: {
  match: BoardMatch;
  teamById: Map<number, BoardData["teams"][number]>;
  flashed: boolean;
}) {
  const a = match.teamAId ? teamById.get(match.teamAId) : null;
  const b = match.teamBId ? teamById.get(match.teamBId) : null;
  const done = match.status === "done";

  return (
    <div
      className={
        "grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs " +
        (flashed ? "flash-once " : "")
      }
    >
      <span
        className={
          "truncate text-right " +
          (done && match.winnerId === match.teamAId ? "font-bold" : "text-[var(--text-muted)]")
        }
      >
        {a?.number ?? "—"}
      </span>
      <span
        className={
          "tnum rounded px-2 py-0.5 font-bold " +
          (done ? "bg-[var(--bg-subtle)]" : "text-[var(--text-subtle)]")
        }
      >
        {done ? `${match.scoreA}:${match.scoreB}` : "–:–"}
      </span>
      <span
        className={
          "truncate " +
          (done && match.winnerId === match.teamBId ? "font-bold" : "text-[var(--text-muted)]")
        }
      >
        {b?.number ?? "—"}
      </span>
    </div>
  );
}

/* ============================================================
   To'r (sumo, robrace)
   ============================================================ */
function BracketView({ data, state, teamById }: ViewProps) {
  const rounds = useMemo(() => {
    const map = new Map<number, BoardMatch[]>();
    for (const match of state.matches) {
      const list = map.get(match.round) ?? [];
      list.push(match);
      map.set(match.round, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [state.matches]);

  const totalRounds = rounds.length;

  if (totalRounds === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Trophy className="size-8" />}
          title="Toʻr hali tuzilmagan"
          hint="Jerebyovkadan keyin bosqichlar shu yerda koʻrinadi."
        />
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-5">
        {rounds.map(([round, matches]) => (
          <section key={round} className="flex w-64 shrink-0 flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {roundName(round, totalRounds)}
            </h2>
            {matches.map((match) => (
              <BracketCard
                key={match.id}
                match={match}
                teamById={teamById}
                category={data.categoryCode}
                flashed={state.flashed.has(match.id)}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function BracketCard({
  match,
  teamById,
  category,
  flashed,
}: {
  match: BoardMatch;
  teamById: Map<number, BoardData["teams"][number]>;
  category: CategoryCode;
  flashed: boolean;
}) {
  const rows: ("a" | "b")[] = ["a", "b"];

  return (
    <Card className={"overflow-hidden " + (flashed ? "flash-once" : "")}>
      {match.isBye && (
        <div className="bg-[var(--bg-subtle)] px-3 py-1 text-[11px] font-semibold text-[var(--text-muted)]">
          Raqibsiz oʻtdi
        </div>
      )}
      {rows.map((side) => {
        const teamId = side === "a" ? match.teamAId : match.teamBId;
        const team = teamId ? teamById.get(teamId) : null;
        const score = side === "a" ? match.scoreA : match.scoreB;
        const isWinner = match.status === "done" && match.winnerId === teamId;

        return (
          <div
            key={side}
            className={
              "flex items-center justify-between gap-2 px-3 py-2 text-sm " +
              (side === "a" ? "border-b border-[var(--border)] " : "") +
              (isWinner ? "font-bold" : "text-[var(--text-muted)]")
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <TeamNumber value={team?.number ?? null} category={category} size="sm" />
              <span className="truncate">{team?.name ?? "kutilmoqda"}</span>
            </div>
            <span className="tnum shrink-0 tabular-nums">
              {match.status === "pending" ? "" : score}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

/* ============================================================
   Vaqt reytingi (linefollower)
   ============================================================ */
function TimeView({ data, state, teamById }: ViewProps) {
  const ranking = computeTimeRanking(data.teams, state.runs);
  const anyResult = state.runs.length > 0;

  if (!anyResult) {
    return (
      <Card>
        <EmptyState
          icon={<Timer className="size-8" />}
          title="Hali birorta urinish yozilmagan"
          hint="Hakam birinchi natijani saqlagach reyting shu yerda paydo boʻladi va oʻzi yangilanadi."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">Linefollower reytingi</caption>
        <thead>
          <tr className="bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-muted)]">
            <th scope="col" className="w-12 py-2.5 pl-4 text-left">
              #
            </th>
            <th scope="col" className="text-left">
              Jamoa
            </th>
            <th scope="col" className="w-24 text-right">
              1-urinish
            </th>
            <th scope="col" className="w-24 text-right">
              2-urinish
            </th>
            <th scope="col" className="w-28 pr-4 text-right">
              Eng yaxshi
            </th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((row, index) => {
            const team = teamById.get(row.teamId);
            const attempt = (n: number) => row.attempts.find((a) => a.attemptNo === n);
            return (
              <tr
                key={row.teamId}
                className={
                  "border-t border-[var(--border)] " +
                  (state.flashed.has(row.teamId) ? "flash-once " : "") +
                  (index < 3 && row.bestMs !== null ? "bg-[var(--brand-soft)]" : "")
                }
              >
                <td className="tnum py-2.5 pl-4 font-bold">{index + 1}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <TeamNumber
                      value={team?.number ?? null}
                      category={data.categoryCode}
                      size="sm"
                    />
                    <span className="line-clamp-1 font-medium">{team?.name}</span>
                  </div>
                </td>
                <td className="tnum text-right text-[var(--text-muted)]">
                  <AttemptCell attempt={attempt(1)} />
                </td>
                <td className="tnum text-right text-[var(--text-muted)]">
                  <AttemptCell attempt={attempt(2)} />
                </td>
                <td className="tnum pr-4 text-right font-bold">
                  {row.bestMs === null ? (
                    <span className="text-[var(--danger)]">{row.dnfOnly ? "DNF" : "—"}</span>
                  ) : (
                    formatMs(row.bestMs)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function AttemptCell({
  attempt,
}: {
  attempt?: { finalMs: number; status: string; attemptNo: number };
}) {
  if (!attempt) return <span className="text-[var(--text-subtle)]">—</span>;
  if (attempt.status === "dnf") return <span className="text-[var(--danger)]">DNF</span>;
  return <>{formatMs(attempt.finalMs)}</>;
}
