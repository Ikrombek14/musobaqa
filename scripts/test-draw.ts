/**
 * SINOV: hamma jamoani roʻyxatdan oʻtkazib, barcha yoʻnalishda
 * jerebyovka oʻtkazadi.
 *
 *   docker compose run --rm --build -T tools \
 *     node --import tsx --conditions=react-server scripts/test-draw.ts
 *
 * Jerebyovka HAQIQIY kod bilan oʻtkaziladi (`performDraw`) — sinov
 * musobaqadagi bilan bir xil boʻlishi kerak, aks holda u hech narsani
 * isbotlamaydi.
 *
 * Tozalash: `scripts/test-clean.ts`
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CATEGORY_LIST } from "@/lib/categories";
import { performDraw } from "@/server/actions/draw";

async function main() {
  /* ---- 1. Check-in: har jamoaga navbatdagi boʻsh yorliq ---- */
  const checkedIn = await db.transaction(async (tx) => {
    const waiting = await tx
      .select({ id: schema.teams.id, categoryCode: schema.teams.categoryCode })
      .from(schema.teams)
      .where(isNull(schema.teams.checkedInAt))
      .orderBy(asc(schema.teams.id));

    let count = 0;
    for (const team of waiting) {
      const [tag] = await tx
        .select({ id: schema.tags.id, code: schema.tags.code, number: schema.tags.number })
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.categoryCode, team.categoryCode),
            isNull(schema.tags.teamId),
          ),
        )
        .orderBy(asc(schema.tags.number))
        .limit(1)
        .for("update");
      if (!tag) continue;

      await tx
        .update(schema.tags)
        .set({ teamId: team.id, assignedAt: new Date(), assignedBy: "Sinov" })
        .where(eq(schema.tags.id, tag.id));

      await tx
        .update(schema.teams)
        .set({
          number: tag.code,
          numberSeq: tag.number,
          checkedInAt: new Date(),
          checkedInBy: "Sinov",
        })
        .where(eq(schema.teams.id, team.id));

      count++;
    }

    if (count > 0) {
      await tx.insert(schema.events).values({
        channel: "all",
        type: "team.checked_in",
        payload: { bulk: true, reason: "sinov" },
      });
    }
    return count;
  });

  console.log(`Roʻyxatdan oʻtkazildi: ${checkedIn} ta jamoa`);

  /* ---- 2. Har yoʻnalishda jerebyovka ---- */
  for (const category of CATEGORY_LIST) {
    try {
      const result = await db.transaction((tx) =>
        performDraw(tx, category.code, "Sinov"),
      );
      console.log(`\n${category.name}\n  ${result.summary}`);
      for (const warning of result.warnings) console.log(`  ogohlantirish: ${warning}`);
    } catch (err) {
      console.log(`\n${category.name}\n  oʻtkazilmadi: ${(err as Error).message}`);
    }
  }

  /* ---- 3. Xulosa ---- */
  const { rows } = await db.execute(sql`
    select category_code, count(*)::int as oyin,
           count(*) filter (where status = 'done')::int as natija
    from matches group by 1 order by 1
  `);
  console.log("\nOʻyinlar:");
  for (const row of rows) console.log(" ", row);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
