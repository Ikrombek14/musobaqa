import { getSession } from "@/lib/auth/session";
import { getMonitorData } from "@/server/queries/monitor";
import { Monitor } from "@/components/admin/monitor";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const session = await getSession();
  if (!session.admin) return null;

  const data = await getMonitorData();
  return <Monitor data={data} />;
}
