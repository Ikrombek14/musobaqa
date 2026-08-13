import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { getOverview } from "@/server/queries/competition";
import { groupStageStatus } from "@/server/actions/playoff";
import { db, schema } from "@/lib/db";
import { CATEGORIES, isCategoryCode } from "@/lib/categories";
import { DrawPanel } from "@/components/admin/draw-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Jerebyovka" };

export default async function DrawPage() {
  // Layout kirmagan foydalanuvchiga kirish formasini koʻrsatadi. Bu yerda
  // xato tashlamaymiz — shunchaki soʻrovlarni bajarmaymiz.
  const session = await getSession();
  if (!session.admin) return null;

  const overview = await getOverview();

  // Guruh formatidagi yo'nalishlar uchun pleyoff holati
  const extras = await Promise.all(
    overview.map(async (row) => {
      if (!isCategoryCode(row.code) || CATEGORIES[row.code].format !== "group_playoff") {
        return { code: row.code, groupStage: null, playoffExists: false };
      }
      const [groupStage, playoff] = await Promise.all([
        groupStageStatus(row.code),
        db
          .select({ id: schema.matches.id })
          .from(schema.matches)
          .where(
            and(
              eq(schema.matches.categoryCode, row.code),
              eq(schema.matches.stage, "playoff"),
            ),
          )
          .limit(1),
      ]);
      return { code: row.code, groupStage, playoffExists: playoff.length > 0 };
    }),
  );
  const extraByCode = new Map(extras.map((e) => [e.code, e]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jerebyovka</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-[var(--text-muted)]">
          Faqat check-in qilingan jamoalar qatnashadi. Har jerebyovkaning seed’i
          saqlanadi — nizo chiqsa natijani qayta hisoblab isbotlash mumkin.
          Robofutbolda bir maktabning ikki jamoasi bitta guruhga tushmaydi.
        </p>
      </div>

      <DrawPanel
        rows={overview.map((row) => ({
          code: row.code,
          drawLocked: row.drawLocked,
          checkedIn: row.checkedIn,
          total: row.total,
          groupSize: row.groupSize,
          matchesTotal: row.matchesTotal,
          matchesPlayed: row.matchesPlayed,
          groupStage: extraByCode.get(row.code)?.groupStage ?? null,
          playoffExists: extraByCode.get(row.code)?.playoffExists ?? false,
        }))}
      />
    </div>
  );
}
