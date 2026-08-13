import Link from "next/link";
import { ArrowRight, Gavel, ScanLine, Tv } from "lucide-react";
import { CATEGORIES, CATEGORY_LIST } from "@/lib/categories";
import { getOverview } from "@/server/queries/competition";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const overview = await getOverview();
  const byCode = new Map(overview.map((row) => [row.code, row]));
  const totalTeams = overview.reduce((sum, row) => sum + row.total, 0);
  const totalChecked = overview.reduce((sum, row) => sum + row.checkedIn, 0);

  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--warning)]">
          16-avgust 2026
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Robototexnika musobaqasi
        </h1>
        <p className="mt-4 max-w-[62ch] text-lg text-[var(--text-muted)]">
          Toʻrt yoʻnalish, bitta tizim: roʻyxatdan oʻtish, jerebyovka, hakamlik
          va jonli natijalar.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/jonli"
            className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--brand)] px-6 font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-hover)]"
          >
            <Tv className="size-5" aria-hidden="true" />
            Jonli natijalar
          </Link>
          <Link
            href="/hakam"
            className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-6 font-semibold transition-colors hover:bg-[var(--bg-subtle)]"
          >
            <Gavel className="size-5" aria-hidden="true" />
            Hakam paneli
          </Link>
          <Link
            href="/admin"
            className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-md)] px-4 font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
          >
            <ScanLine className="size-5" aria-hidden="true" />
            Tashkilotchilar
          </Link>
        </div>

        {totalTeams > 0 && (
          <p className="tnum mt-6 text-sm text-[var(--text-muted)]">
            <span className="font-bold text-[var(--text)]">{totalChecked}</span> ta jamoa
            roʻyxatdan oʻtgan · jami {totalTeams} ta
          </p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold tracking-tight">Yoʻnalishlar</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {CATEGORY_LIST.map((cat) => {
            const row = byCode.get(cat.code);
            return (
              <Link
                key={cat.code}
                href={`/jonli/${cat.slug}`}
                className="group rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                <Card className="h-full p-5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-md)]">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-9 w-1.5 rounded-full"
                      style={{ backgroundColor: CATEGORIES[cat.code].colorVar }}
                      aria-hidden="true"
                    />
                    <h3 className="font-bold">{cat.name}</h3>
                    <ArrowRight
                      className="ml-auto size-4 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    {cat.format === "group_playoff" &&
                      "Guruh bosqichi va pleyoff. Gʻalaba 3, durang 1 ochko."}
                    {cat.format === "single_elim" &&
                      cat.code === "S" &&
                      "Olib tashlash, 3 tadan 2 (best of 3)."}
                    {cat.format === "single_elim" &&
                      cat.code === "RR" &&
                      "Olib tashlash, bitta raundda yonma-yon poyga."}
                    {cat.format === "time_trial" &&
                      "2 urinish, eng yaxshisi. Yoʻldan chiqish +5 soniya."}
                  </p>
                  <p className="tnum mt-3 text-sm font-semibold">
                    {row?.checkedIn ?? 0} jamoa
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
