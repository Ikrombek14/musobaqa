import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { CATEGORIES, CATEGORY_LIST } from "@/lib/categories";
import { getOverview } from "@/server/queries/competition";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jonli natijalar",
  description: "Barcha yoʻnalishlar boʻyicha jonli holat.",
};

export default async function LiveIndexPage() {
  const overview = await getOverview();
  const byCode = new Map(overview.map((row) => [row.code, row]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
          16-avgust 2026
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Jonli natijalar
        </h1>
        <p className="mt-3 max-w-[60ch] text-[var(--text-muted)]">
          Yoʻnalishni tanlang. Natijalar hakam saqlagan zahoti oʻzi yangilanadi —
          sahifani qayta yuklash shart emas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORY_LIST.map((cat) => {
          const row = byCode.get(cat.code);
          const played = row?.matchesPlayed ?? 0;
          const total = row?.matchesTotal ?? 0;
          const progress = total > 0 ? Math.round((played / total) * 100) : 0;

          return (
            <Link
              key={cat.code}
              href={`/jonli/${cat.slug}`}
              className="group rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              <Card className="h-full p-5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:border-[var(--border-strong)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-10 w-1.5 rounded-full"
                      style={{ backgroundColor: CATEGORIES[cat.code].colorVar }}
                      aria-hidden="true"
                    />
                    <div>
                      <h2 className="text-lg font-bold">{cat.name}</h2>
                      <p className="tnum text-sm text-[var(--text-muted)]">
                        {row?.checkedIn ?? 0} jamoa roʻyxatdan oʻtgan
                      </p>
                    </div>
                  </div>
                  <ArrowRight
                    className="size-5 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>

                <div className="mt-5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Oʻyinlar</span>
                    <span className="tnum font-semibold">
                      {played} / {total || "—"}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]"
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${cat.name} oʻyinlari bajarildi`}
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: CATEGORIES[cat.code].colorVar,
                      }}
                    />
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
