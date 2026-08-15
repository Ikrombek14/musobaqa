import type { Metadata } from "next";
import { getTabloData } from "@/server/queries/tablo";
import { TabloScreen } from "@/components/tablo/tablo-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jonli tablo",
  description: "Robototexnika musobaqasi — katta ekran uchun jonli tablo.",
  robots: { index: false },
};

/**
 * Katta ekran (proyektor / TV) uchun tablo.
 *
 * Boshlangʻich holat serverdan keladi — ekran yoqilishi bilan toʻla
 * koʻrinadi, boʻsh kadr boʻlmaydi. Keyin har 5 soniyada
 * `/api/tablo/live` dan yangilanadi.
 */
export default async function TabloPage() {
  const data = await getTabloData();
  return <TabloScreen initial={data} />;
}
