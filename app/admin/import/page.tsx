import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { ImportScreen } from "@/components/admin/import-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Excel import" };

export default async function ImportPage() {
  const session = await getSession();
  if (!session.admin) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Excel import</h1>
      </div>

      <ImportScreen />
    </div>
  );
}
