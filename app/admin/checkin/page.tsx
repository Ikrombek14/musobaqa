import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { getOverview } from "@/server/queries/competition";
import { CheckInScreen } from "@/components/admin/checkin-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Check-in" };

export default async function CheckInPage() {
  // Layout gate qiladi — bu yerda faqat soʻrovni tejaymiz
  const session = await getSession();
  if (!session.admin) return null;

  const overview = await getOverview();

  const checkedIn = overview.reduce((sum, row) => sum + row.checkedIn, 0);
  const total = overview.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Roʻyxatdan oʻtkazish</h1>
        <p className="tnum text-sm text-[var(--text-muted)]">
          <span className="font-bold text-[var(--text)]">{checkedIn}</span> / {total} jamoa
          keldi
        </p>
      </div>

      <CheckInScreen />
    </div>
  );
}
