"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Gavel, MonitorPlay, Radio, Users } from "lucide-react";
import { useLive } from "@/lib/realtime/use-live";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import { formatTime } from "@/lib/format";
import { Badge, Card, EmptyState, LiveDot, TeamNumber } from "@/components/ui/primitives";
import type { MonitorData } from "@/server/queries/monitor";

/**
 * Boshqaruv markazi.
 *
 * Barcha yoʻnalishlarni bitta ekranda kuzatish uchun. `all` kanaliga
 * ulanadi — istalgan yoʻnalishdagi har qanday oʻzgarish shu yerga tushadi.
 *
 * Har hodisada darhol `router.refresh()` chaqirmaymiz: 5 hakam bir vaqtda
 * yozsa serverga 5 ta soʻrov ketardi. Hodisalar 500 ms oynada toʻplanadi
 * va bitta yangilanish boʻladi — ekran baribir «jonli» koʻrinadi, lekin
 * server bekorga yuklanmaydi.
 */
export function Monitor({ data }: { data: MonitorData }) {
  const router = useRouter();
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const status = useLive("all", data.sinceId, () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
      setLastUpdate(new Date());
    }, 500);
  });

  useEffect(() => {
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  const totals = data.pulse.reduce(
    (acc, row) => ({
      teams: acc.teams + row.teams,
      checkedIn: acc.checkedIn + row.checkedIn,
      done: acc.done + row.matchesDone + row.runsDone,
      total: acc.total + row.matchesTotal + row.runsTotal,
      live: acc.live + row.matchesLive,
    }),
    { teams: 0, checkedIn: 0, done: 0, total: 0, live: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Boshqaruv markazi</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            16-avgust 2026 · barcha yoʻnalishlar bitta ekranda
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="tnum text-xs text-[var(--text-subtle)]">
              yangilandi {formatTime(lastUpdate)}
            </span>
          )}
          <LiveDot status={status} />
        </div>
      </div>

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={<Users className="size-4" aria-hidden="true" />}
          label="Roʻyxatdan oʻtgan"
          value={`${totals.checkedIn} / ${totals.teams}`}
          hint="jamoa keldi"
        />
        <Metric
          icon={<Activity className="size-4" aria-hidden="true" />}
          label="Bajarilgan"
          value={`${totals.done} / ${totals.total || "—"}`}
          hint="oʻyin va urinish"
        />
        <Metric
          icon={<Radio className="size-4" aria-hidden="true" />}
          label="Hozir ketmoqda"
          value={String(totals.live)}
          hint="uchrashuv"
          accent={totals.live > 0}
        />
        <Metric
          icon={<Gavel className="size-4" aria-hidden="true" />}
          label="Faol hakam"
          value={String(data.judgesOnline.filter((j) => j.active).length)}
          hint={`jami ${data.judgesOnline.length} ta`}
        />
      </div>

      {/* Yo'nalishlar pulsi */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Yoʻnalishlar
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.pulse.map((row) => {
            const category = CATEGORIES[row.code];
            const isTime = category.format === "time_trial";
            const done = isTime ? row.runsDone : row.matchesDone;
            const total = isTime ? row.runsTotal : row.matchesTotal;
            const percent = total > 0 ? Math.round((done / total) * 100) : 0;

            return (
              <Card key={row.code} className="p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-6 w-1.5 rounded-full"
                    style={{ backgroundColor: category.colorVar }}
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-bold">{category.name}</h3>
                  {row.matchesLive > 0 && (
                    <span className="ml-auto">
                      <Badge tone="warning">{row.matchesLive} ketmoqda</Badge>
                    </span>
                  )}
                </div>

                <p className="tnum mt-3 text-2xl font-bold">
                  {done}
                  <span className="text-base font-normal text-[var(--text-muted)]">
                    {" "}
                    / {total || "—"}
                  </span>
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {isTime ? "urinish" : "oʻyin"} · {row.checkedIn} jamoa ·{" "}
                  {row.fieldCount} maydon
                </p>

                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${category.name} bajarildi`}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${percent}%`, backgroundColor: category.colorVar }}
                  />
                </div>

                {!row.drawLocked && (
                  <p className="mt-2 text-xs text-[var(--warning)]">
                    Jerebyovka oʻtkazilmagan
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* Maydonlar */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Maydonlar · hozir nima boʻlyapti
        </h2>
        {data.fields.length === 0 ? (
          <Card>
            <EmptyState
              icon={<MonitorPlay className="size-8" />}
              title="Maydonlarda oʻyin yoʻq"
              hint="Jerebyovka oʻtkazilgach oʻyinlar maydonlarga taqsimlanadi va shu yerda koʻrinadi."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.fields.map((field) => {
              const category = CATEGORIES[field.categoryCode as CategoryCode];
              return (
                <Card
                  key={`${field.categoryCode}-${field.fieldNo}`}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: category?.colorVar }}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-bold">
                      {category?.name} · {field.fieldNo}-maydon
                    </span>
                    <span className="tnum ml-auto text-xs text-[var(--text-muted)]">
                      {field.done} boʻldi · {field.waiting} navbatda
                    </span>
                  </div>

                  {field.current ? (
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                        <span>
                          {field.current.groupName
                            ? `${field.current.groupName} guruh`
                            : "Pleyoff"}
                        </span>
                        {field.current.status === "live" ? (
                          <Badge tone="warning">Ketmoqda</Badge>
                        ) : (
                          <Badge tone="neutral">Navbatda</Badge>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <TeamNumber
                          value={field.current.numberA}
                          category={field.categoryCode as CategoryCode}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {field.current.teamA ?? "—"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <TeamNumber
                          value={field.current.numberB}
                          category={field.categoryCode as CategoryCode}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {field.current.teamB ?? "—"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                      Bu maydonda hamma oʻyin tugadi
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Oxirgi natijalar */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Oxirgi natijalar
          </h2>
          <Link
            href="/admin/juftliklar"
            className="text-sm font-medium text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
          >
            Hamma juftliklar
          </Link>
        </div>

        {data.recent.length === 0 ? (
          <Card>
            <EmptyState
              title="Hali natija yozilmagan"
              hint="Hakam birinchi natijani saqlagach shu yerda darhol paydo boʻladi."
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul>
              {data.recent.map((item) => {
                const category = CATEGORIES[item.categoryCode as CategoryCode];
                return (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 last:border-0"
                  >
                    <span
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: category?.colorVar }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="tnum truncate text-sm font-semibold">{item.label}</p>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {item.detail}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-xs text-[var(--text-muted)]">
                        {formatTime(item.at)}
                      </p>
                      {item.judge && (
                        <p className="truncate text-xs text-[var(--text-subtle)]">
                          {item.judge}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {icon}
        {label}
      </p>
      <p
        className="tnum mt-2 text-3xl font-bold tracking-tight"
        style={accent ? { color: "var(--warning)" } : undefined}
      >
        {value}
      </p>
      <p className="mt-0.5 text-sm text-[var(--text-muted)]">{hint}</p>
    </Card>
  );
}
