import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { getOverview } from "@/server/queries/competition";
import { fieldLoad, listGroupsWithFields } from "@/server/queries/admin";
import { isCategoryCode } from "@/lib/categories";
import { SettingsPanel, type CategorySettings } from "@/components/admin/settings-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sozlamalar" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session.admin) return null;

  const overview = await getOverview();

  const categories: CategorySettings[] = await Promise.all(
    overview.filter((row) => isCategoryCode(row.code)).map(async (row) => {
      const code = row.code as CategorySettings["code"];
      const [groups, load] = await Promise.all([
        listGroupsWithFields(code),
        fieldLoad(code),
      ]);
      return {
        code,
        fieldCount: row.fieldCount,
        groupSize: row.groupSize,
        matchMinutes: row.matchMinutes,
        advancePerGroup: row.advancePerGroup,
        drawLocked: row.drawLocked,
        checkedIn: row.checkedIn,
        matchesTotal: row.matchesTotal,
        matchesDone: row.matchesPlayed,
        groups,
        fieldLoad: load,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sozlamalar</h1>
      </div>

      <SettingsPanel categories={categories} />
    </div>
  );
}
