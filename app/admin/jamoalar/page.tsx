import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { listTeamsAdmin } from "@/server/queries/teams";
import { currentEventId } from "@/lib/realtime/bus";
import { isCategoryCode, type CategoryCode } from "@/lib/categories";
import { TeamsTable } from "@/components/admin/teams-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Jamoalar" };

export default async function TeamsPage({ searchParams }: PageProps<"/admin/jamoalar">) {
  const session = await getSession();
  if (!session.admin) return null;

  const sp = await searchParams;
  const rawCategory = typeof sp.category === "string" ? sp.category : "all";
  const rawStatus = typeof sp.status === "string" ? sp.status : "all";
  const query = typeof sp.q === "string" ? sp.q : "";

  const category: CategoryCode | "all" = isCategoryCode(rawCategory) ? rawCategory : "all";
  const status =
    rawStatus === "checked" || rawStatus === "waiting" ? rawStatus : ("all" as const);

  const [teams, all, sinceId] = await Promise.all([
    listTeamsAdmin({ category, status, query }),
    listTeamsAdmin({}),
    currentEventId(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jamoalar</h1>
        <p className="mt-1 max-w-[75ch] text-sm text-[var(--text-muted)]">
          Barcha ishtirokchilar, ularning maktabi, murabbiysi va guruhi. Check-in
          real vaqtda tushib turadi — roʻyxatdan oʻtish stoli ishlaganda bu
          sahifani ochiq qoldirsangiz yetarli.
        </p>
      </div>

      <TeamsTable
        teams={teams}
        sinceId={sinceId}
        totals={{
          all: all.length,
          checked: all.filter((t) => t.checkedInAt !== null).length,
        }}
      />
    </div>
  );
}
