"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shuffle, Swords } from "lucide-react";
import { useLive } from "@/lib/realtime/use-live";
import { CATEGORIES, CATEGORY_LIST, type CategoryCode } from "@/lib/categories";
import { Badge, Card, EmptyState, LiveDot, TeamNumber } from "@/components/ui/primitives";
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
                <PairSection
                  title="Pleyoff"
                  pairs={playoffPairs}
                  categoryCode={data.categoryCode}
                  groupBy="roundLabel"
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

/* ---------------- Guruh tarkiblari ---------------- */
function GroupCompositions({ data }: { data: PairingsData }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Guruh tarkiblari
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.groups.map((group) => {
          const schools = group.teams.map((t) => (t.school ?? "").trim().toLowerCase());
          const clash = new Set(schools.filter(Boolean)).size !== schools.filter(Boolean).length;

          return (
            <Card key={group.id} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2">
                <span className="text-sm font-bold">{group.name} guruh</span>
                <span className="tnum text-xs text-[var(--text-muted)]">
                  {group.teams.length} jamoa
                </span>
                <span className="ml-auto flex items-center gap-1.5">
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

              <ul>
                {group.teams.map((team) => (
                  <li
                    key={team.id}
                    className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 last:border-0"
                  >
                    <TeamNumber
                      value={team.number}
                      category={data.categoryCode}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{team.name}</span>
                      <span className="block truncate text-xs text-[var(--text-muted)]">
                        {team.school ?? "—"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
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
              <li
                key={pair.matchId}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 last:border-0"
              >
                <Side
                  team={pair.a}
                  categoryCode={categoryCode}
                  align="right"
                  winner={pair.winnerId !== null && pair.winnerId === pair.a?.id}
                />

                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={
                      "tnum rounded px-2 py-0.5 text-sm font-bold " +
                      (pair.status === "done"
                        ? "bg-[var(--bg-subtle)]"
                        : "text-[var(--text-subtle)]")
                    }
                  >
                    {pair.status === "bye"
                      ? "raqibsiz"
                      : pair.status === "done"
                        ? `${pair.scoreA}:${pair.scoreB}`
                        : "–:–"}
                  </span>
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
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
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
