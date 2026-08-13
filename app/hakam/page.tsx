import type { Metadata } from "next";
import Link from "next/link";
import { LogOut, Tv } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { judgeLogout } from "@/server/actions/judge";
import { getJudgeWork } from "@/server/queries/judge";
import { CATEGORIES } from "@/lib/categories";
import { PinLogin } from "@/components/judge/pin-login";
import { JudgePanel } from "@/components/judge/judge-panel";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hakam paneli",
  robots: { index: false },
};

export default async function JudgePage() {
  const session = await getSession();

  if (!session.judge) {
    return (
      <main id="main" className="flex-1">
        <PinLogin />
      </main>
    );
  }

  const judge = session.judge;
  const category = CATEGORIES[judge.categoryCode];
  const work = await getJudgeWork(judge);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <span
            className="h-8 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: category.colorVar }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{category.name}</p>
            <p className="truncate text-xs text-[var(--text-muted)]">
              {judge.name}
              {judge.fieldNo ? ` · ${judge.fieldNo}-maydon` : ""}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href={`/jonli/${category.slug}`}
              className="inline-flex size-10 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
              aria-label="Jonli tabloni ochish"
            >
              <Tv className="size-5" aria-hidden="true" />
            </Link>
            <form action={judgeLogout}>
              <Button type="submit" variant="ghost" size="sm" aria-label="Chiqish">
                <LogOut className="size-4" aria-hidden="true" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <JudgePanel
          work={work}
          categoryCode={judge.categoryCode}
          judgeName={judge.name}
          fieldNo={judge.fieldNo}
        />
      </main>
    </div>
  );
}
