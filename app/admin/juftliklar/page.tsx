import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { categoryBySlug, CATEGORIES } from "@/lib/categories";
import { getPairings } from "@/server/queries/teams";
import { PairingsView } from "@/components/admin/pairings-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Juftliklar" };

export default async function PairingsPage({ searchParams }: PageProps<"/admin/juftliklar">) {
  const session = await getSession();
  if (!session.admin) return null;

  const sp = await searchParams;
  const slug = typeof sp.yonalish === "string" ? sp.yonalish : "";
  const category = categoryBySlug(slug) ?? CATEGORIES.F;

  const data = await getPairings(category.code);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kim bilan kim</h1>
        <p className="mt-1 max-w-[75ch] text-sm text-[var(--text-muted)]">
          Jerebyovka natijasi: guruh tarkiblari va barcha juftliklar. Natijalar
          yozilgani sari shu sahifa oʻzi yangilanadi.
        </p>
      </div>

      <PairingsView data={data} />
    </div>
  );
}
