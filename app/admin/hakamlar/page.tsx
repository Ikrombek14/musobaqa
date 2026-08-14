import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { listJudges } from "@/server/queries/admin";
import { getOverview } from "@/server/queries/competition";
import { JudgesPanel } from "@/components/admin/judges-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hakamlar" };

export default async function JudgesAdminPage() {
  const session = await getSession();
  if (!session.admin) return null;

  const [judges, overview] = await Promise.all([listJudges(), getOverview()]);
  const fieldCounts = Object.fromEntries(
    overview.map((row) => [row.code, row.fieldCount]),
  ) as Record<string, number>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hakamlar</h1>
      </div>

      <JudgesPanel judges={judges} fieldCounts={fieldCounts} />
    </div>
  );
}
