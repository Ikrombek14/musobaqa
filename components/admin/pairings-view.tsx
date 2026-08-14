"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Shuffle, Swords, Trash2 } from "lucide-react";
import { useLive } from "@/lib/realtime/use-live";
import { CATEGORIES, CATEGORY_LIST, type CategoryCode } from "@/lib/categories";
import { computeGroupTable } from "@/lib/standings";
import { formatDiff } from "@/lib/format";
import { Badge, Card, EmptyState, LiveDot, TeamNumber } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { clearMatchResult, setMatchResult } from "@/server/actions/admin-matches";
import type { PairingsData, PairRow } from "@/server/queries/teams";

/**
 * «Kim bilan kim tushdi» ekrani.
 *
 * Jerebyovka natijasini bir qarashda tekshirish uchun: guruh tarkiblari
 * maktab nomi bilan koʻrsatiladi, chunki eng koʻp beriladigan savol —
 * «nega bitta maktabning ikki jamoasi bitta guruhda?». Bunday holat
 * boʻlsa qator alohida belgilanadi.
 */
export function PairingsView({ data }: { data: PairingsData }) {
  const router = useRouter();
  const category = CATEGORIES[data.categoryCode];

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = useLive(data.categoryCode, data.sinceId, () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
    }, 500);
  });

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  const groupPairs = data.pairs.filter((p) => p.stage === "group");
  const playoffPairs = data.pairs.filter((p) => p.stage === "playoff");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Yoʻnalishlar" className="flex flex-wrap gap-1">
          {CATEGORY_LIST.map((cat) => (
            <Link
              key={cat.code}
              href={`/admin/juftliklar?yonalish=${cat.slug}`}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
                (cat.code === data.categoryCode
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]")
              }
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: cat.colorVar }}
                aria-hidden="true"
              />
              {cat.name}
            </Link>
          ))}
        </nav>
        <LiveDot status={status} />
      </div>

      {!data.drawLocked ? (
        <Card>
          <EmptyState
            icon={<Shuffle className="size-8" />}
            title="Jerebyovka hali oʻtkazilmagan"
            hint={`${category.name} boʻyicha juftliklar jerebyovkadan keyin shu yerda koʻrinadi.`}
            action={
              <Link
                href="/admin/draw"
                className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--brand-ink)]"
              >
                Jerebyovkaga oʻtish
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {data.groups.length > 0 && <GroupCompositions data={data} />}

          {category.format === "time_trial" ? (
            <StartOrder data={data} />
          ) : (
            <>
              {groupPairs.length > 0 && (
                <PairSection
                  title="Guruh oʻyinlari"
                  pairs={groupPairs}
                  categoryCode={data.categoryCode}
                  groupBy="roundLabel"
                />
              )}
              {playoffPairs.length > 0 && (
                <BracketBoard
                  pairs={playoffPairs}
                  categoryCode={data.categoryCode}
                  totalRounds={data.totalRounds}
                />
              )}
              {groupPairs.length === 0 && playoffPairs.length === 0 && (
                <Card>
                  <EmptyState
                    icon={<Swords className="size-8" />}
                    title="Oʻyinlar tuzilmagan"
                    hint="Jerebyovka oʻtkazilgan, lekin oʻyin roʻyxati boʻsh."
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Guruh jadvallari (jonli ochko) ---------------- */

/**
 * Guruh tarkibi + turnir jadvali bitta kartochkada.
 *
 * Ochko, gol farqi va kim chiqayotgani real vaqtda hisoblanadi:
 * hakam natijani saqlashi bilan SSE hodisasi keladi, sahifa yangilanadi
 * va jadval qayta chiziladi. Hisob mijozda `computeGroupTable` bilan
 * bajariladi — hakam panelidagi va tablodagi bilan AYNI funksiya.
 */
function GroupCompositions({ data }: { data: PairingsData }) {
  const matchesByGroup = new Map<string, PairRow[]>();
  for (const pair of data.pairs) {
    if (pair.stage !== "group" || !pair.groupName) continue;
    matchesByGroup.set(pair.groupName, [...(matchesByGroup.get(pair.groupName) ?? []), pair]);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Guruh jadvallari
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          Yashil qator — pleyoffga chiqmoqda ({data.advancePerGroup} tadan)
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.groups.map((group) => {
          const schools = group.teams.map((t) => (t.school ?? "").trim().toLowerCase());
          const clash = new Set(schools.filter(Boolean)).size !== schools.filter(Boolean).length;

          const groupMatches = matchesByGroup.get(group.name) ?? [];
          const table = computeGroupTable(
            group.teams.map((t) => ({ id: t.id, name: t.name, number: t.number })),
            groupMatches.map((m) => ({
              teamAId: m.a?.id ?? null,
              teamBId: m.b?.id ?? null,
              scoreA: m.scoreA,
              scoreB: m.scoreB,
              status: m.status,
            })),
          );
          const teamById = new Map(group.teams.map((t) => [t.id, t]));
          const played = groupMatches.filter((m) => m.status === "done").length;
          const complete = groupMatches.length > 0 && played === groupMatches.length;

          return (
            <Card key={group.id} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2">
                <span className="text-sm font-bold">{group.name} guruh</span>
                <span className="tnum text-xs text-[var(--text-muted)]">
                  {played}/{groupMatches.length} oʻyin
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {complete && <Badge tone="success">Tugadi</Badge>}
                  {group.fieldNo ? (
                    <Badge tone="brand">{group.fieldNo}-maydon</Badge>
                  ) : (
                    <Badge tone="neutral">Avtomatik</Badge>
                  )}
                </span>
              </div>

              {clash && (
                <p className="bg-[var(--warning-soft)] px-4 py-1.5 text-xs font-medium text-[var(--warning)]">
                  Bir maktabning bir nechta jamoasi shu guruhda
                </p>
              )}

              <table className="w-full text-sm">
                <caption className="sr-only">{group.name} guruh turnir jadvali</caption>
                <thead>
                  <tr className="text-[11px] font-semibold text-[var(--text-muted)]">
                    <th scope="col" className="py-1.5 pl-4 text-left">
                      Jamoa
                    </th>
                    <th scope="col" className="w-7 text-right" title="Oʻynadi">
                      O
                    </th>
                    <th scope="col" className="w-7 text-right" title="Gʻalaba">
                      G
                    </th>
                    <th scope="col" className="w-9 text-right" title="Gol farqi">
                      ±
                    </th>
                    <th scope="col" className="w-9 pr-4 text-right" title="Ochko">
                      Ochko
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((row, index) => {
                    const team = teamById.get(row.teamId);
                    const qualifies = index < data.advancePerGroup;
                    return (
                      <tr
                        key={row.teamId}
                        className={
                          "border-t border-[var(--border)] " +
                          (qualifies ? "bg-[var(--success-soft)]" : "")
                        }
                      >
                        <td className="py-1.5 pl-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="tnum w-4 shrink-0 text-xs text-[var(--text-subtle)]">
                              {index + 1}
                            </span>
                            <TeamNumber
                              value={team?.number ?? null}
                              category={data.categoryCode}
                              size="sm"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {team?.name}
                              </span>
                              <span className="block truncate text-[11px] text-[var(--text-muted)]">
                                {team?.school ?? "—"}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="tnum text-right text-[var(--text-muted)]">{row.played}</td>
                        <td className="tnum text-right text-[var(--text-muted)]">{row.won}</td>
                        <td className="tnum text-right text-[var(--text-muted)]">
                          {formatDiff(row.diff)}
                        </td>
                        <td className="tnum pr-4 text-right font-bold">{row.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Vizual toʻr ---------------- */

/**
 * Pleyoff toʻri — bosqichlar ustun boʻlib, chapdan oʻngga.
 *
 * Toʻrni tizim jerebyovkada oʻzi tuzadi; bu yerda faqat chiziladi.
 * Har oʻyin ikki qator: gʻolib qalin, yutqazgan xira. Keyingi bosqichda
 * kim kim bilan uchrashishi shu yerdan darhol koʻrinadi.
 */
function BracketBoard({
  pairs,
  categoryCode,
  totalRounds,
}: {
  pairs: PairRow[];
  categoryCode: CategoryCode;
  totalRounds: number;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const onToggle = (id: number) => setEditingId((current) => (current === id ? null : id));

  const rounds = new Map<string, PairRow[]>();
  for (const pair of pairs) {
    rounds.set(pair.roundLabel, [...(rounds.get(pair.roundLabel) ?? []), pair]);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Toʻr · {pairs.length} oʻyin
      </h2>

      {/* Bosqichlar koʻp boʻlsa gorizontal siljiydi — sahifa emas */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {[...rounds.entries()].map(([label, list]) => (
            <div key={label} className="flex w-60 shrink-0 flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-subtle)]">
                {label} · {list.filter((m) => m.status === "done").length}/{list.length}
              </p>
              {list.map((pair) => (
                <Card key={pair.matchId} className="overflow-hidden">
                  {pair.status === "bye" && (
                    <p className="bg-[var(--bg-subtle)] px-3 py-1 text-[11px] font-semibold text-[var(--text-muted)]">
                      Raqibsiz oʻtdi
                    </p>
                  )}
                  {(["a", "b"] as const).map((side) => {
                    const team = pair[side];
                    const score = side === "a" ? pair.scoreA : pair.scoreB;
                    const winner = pair.winnerId !== null && pair.winnerId === team?.id;
                    return (
                      <div
                        key={side}
                        className={
                          "flex items-center gap-2 px-3 py-2 text-sm " +
                          (side === "a" ? "border-b border-[var(--border)] " : "") +
                          (winner ? "font-bold" : "text-[var(--text-muted)]")
                        }
                      >
                        <TeamNumber
                          value={team?.number ?? null}
                          category={categoryCode}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {team?.name ?? "kutilmoqda"}
                        </span>
                        <span className="tnum shrink-0 font-semibold">
                          {pair.status === "done" ? score : "–"}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-1">
                    <span className="text-[11px] text-[var(--text-subtle)]">
                      {pair.fieldNo ? `${pair.fieldNo}-maydon` : "maydonsiz"}
                    </span>
                    {pair.status !== "bye" && pair.a && pair.b && (
                      <button
                        type="button"
                        onClick={() => onToggle(pair.matchId)}
                        aria-expanded={editingId === pair.matchId}
                        className="ml-auto text-[11px] font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
                      >
                        Tuzatish
                      </button>
                    )}
                  </div>

                  {editingId === pair.matchId && (
                    <ResultEditor pair={pair} onDone={() => onToggle(pair.matchId)} />
                  )}
                </Card>
              ))}
            </div>
          ))}
        </div>
      </div>

      {totalRounds > 0 && rounds.size < totalRounds && (
        <p className="text-xs text-[var(--text-muted)]">
          Keyingi bosqichlar oldingisi tugagach oʻzi ochiladi.
        </p>
      )}
    </section>
  );
}

/* ---------------- Juftliklar ---------------- */
function PairSection({
  title,
  pairs,
  categoryCode,
  groupBy,
}: {
  title: string;
  pairs: PairRow[];
  categoryCode: CategoryCode;
  groupBy: "roundLabel";
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const onToggle = (id: number) => setEditingId((current) => (current === id ? null : id));

  const buckets = new Map<string, PairRow[]>();
  for (const pair of pairs) {
    const key = pair[groupBy];
    const list = buckets.get(key) ?? [];
    list.push(pair);
    buckets.set(key, list);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title} · {pairs.length} ta
      </h2>

      {[...buckets.entries()].map(([label, list]) => (
        <Card key={label} className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2">
            <span className="text-sm font-bold">{label}</span>
            <span className="tnum text-xs text-[var(--text-muted)]">
              {list.filter((p) => p.status === "done").length}/{list.length} yakunlangan
            </span>
          </div>

          <ul>
            {list.map((pair) => (
              <li key={pair.matchId} className="border-b border-[var(--border)] last:border-0">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5">
                  <Side
                    team={pair.a}
                    categoryCode={categoryCode}
                    align="right"
                    winner={pair.winnerId !== null && pair.winnerId === pair.a?.id}
                  />

                  <div className="flex flex-col items-center gap-0.5">
                    {/* Hisobning oʻzi tugma — tuzatish uchun bitta bosish */}
                    <button
                      type="button"
                      onClick={() => onToggle(pair.matchId)}
                      disabled={pair.status === "bye" || !pair.a || !pair.b}
                      aria-expanded={editingId === pair.matchId}
                      title="Natijani tuzatish"
                      className={
                        "tnum rounded px-2 py-0.5 text-sm font-bold transition-colors " +
                        (pair.status === "done"
                          ? "bg-[var(--bg-subtle)] hover:bg-[var(--border)]"
                          : "text-[var(--text-subtle)] hover:bg-[var(--bg-subtle)]") +
                        (pair.status === "bye" ? " cursor-default" : "")
                      }
                    >
                      {pair.status === "bye"
                        ? "raqibsiz"
                        : pair.status === "done"
                          ? `${pair.scoreA}:${pair.scoreB}`
                          : "–:–"}
                    </button>
                    <span className="text-[10px] text-[var(--text-subtle)]">
                      {pair.groupName && `${pair.groupName} · `}
                      {pair.fieldNo ? `${pair.fieldNo}-maydon` : "maydonsiz"}
                    </span>
                  </div>

                  <Side
                    team={pair.b}
                    categoryCode={categoryCode}
                    align="left"
                    winner={pair.winnerId !== null && pair.winnerId === pair.b?.id}
                  />
                </div>

                {editingId === pair.matchId && (
                  <ResultEditor pair={pair} onDone={() => onToggle(pair.matchId)} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}

/* ---------------- Natijani tuzatish ---------------- */

/**
 * Admin har qanday oʻyin natijasini tuzatadi.
 *
 * Hakam faqat oʻz maydonini koʻradi va keyingi bosqich boshlangach
 * tegolmaydi — nizo chiqsa yoki hakam xato yozsa yagona yoʻl shu yer.
 * Har oʻzgarish audit jurnaliga admin nomi bilan tushadi.
 */
function ResultEditor({
  pair,
  onDone,
}: {
  pair: PairRow;
  onDone: () => void;
}) {
  const [a, setA] = useState(pair.status === "done" ? pair.scoreA : 0);
  const [b, setB] = useState(pair.status === "done" ? pair.scoreB : 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await setMatchResult(pair.matchId, a, b);
      if (result.ok) onDone();
      else setError(result.error);
    });

  const clear = () =>
    startTransition(async () => {
      setError(null);
      const result = await clearMatchResult(pair.matchId);
      if (result.ok) onDone();
      else setError(result.error);
    });

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg-subtle)] p-3">
      <div className="flex items-center justify-center gap-2">
        <label className="sr-only" htmlFor={`sa-${pair.matchId}`}>
          {pair.a?.name ?? "A"} hisobi
        </label>
        <input
          id={`sa-${pair.matchId}`}
          inputMode="numeric"
          value={a}
          onChange={(e) => setA(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
          className="tnum h-10 w-14 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-center text-lg font-bold"
        />
        <span className="text-[var(--text-muted)]">:</span>
        <label className="sr-only" htmlFor={`sb-${pair.matchId}`}>
          {pair.b?.name ?? "B"} hisobi
        </label>
        <input
          id={`sb-${pair.matchId}`}
          inputMode="numeric"
          value={b}
          onChange={(e) => setB(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
          className="tnum h-10 w-14 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-center text-lg font-bold"
        />
      </div>

      {a === b && (
        <p className="text-center text-xs font-medium text-[var(--warning)]">
          Hisob teng — gʻolib aniqlanishi shart
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="sm" loading={pending} disabled={a === b} onClick={save}>
          <Check className="size-4" aria-hidden="true" />
          Saqlash
        </Button>
        {pair.status === "done" && (
          <Button variant="ghost" size="sm" loading={pending} onClick={clear}>
            <Trash2 className="size-4" aria-hidden="true" />
            Tozalash
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Yopish
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function Side({
  team,
  categoryCode,
  align,
  winner,
}: {
  team: PairRow["a"];
  categoryCode: CategoryCode;
  align: "left" | "right";
  winner: boolean;
}) {
  return (
    <div
      className={
        "flex min-w-0 items-center gap-2 " +
        (align === "right" ? "flex-row-reverse text-right" : "text-left")
      }
    >
      <TeamNumber value={team?.number ?? null} category={categoryCode} size="sm" />
      <span className="min-w-0">
        <span
          className={
            "block truncate text-sm " + (winner ? "font-bold" : "text-[var(--text-muted)]")
          }
        >
          {team?.name ?? "kutilmoqda"}
        </span>
        <span className="block truncate text-xs text-[var(--text-subtle)]">
          {team?.school ?? ""}
        </span>
      </span>
    </div>
  );
}

/* ---------------- Start tartibi ---------------- */
function StartOrder({ data }: { data: PairingsData }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Start tartibi · {data.startOrder.length} jamoa
      </h2>
      <Card className="overflow-hidden">
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3">
          {data.startOrder.map((team, index) => (
            <li
              key={team.id}
              className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5"
            >
              <span className="tnum w-6 text-sm font-bold text-[var(--text-subtle)]">
                {index + 1}
              </span>
              <TeamNumber value={team.number} category={data.categoryCode} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
