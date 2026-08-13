/**
 * Raqamlashning poyga holatiga chidamliligini tekshiradi:
 *   npx tsx --env-file=.env.local scripts/verify-numbering.ts
 *
 * 20 ta jamoani 20 ta PARALLEL ulanishdan bir vaqtda check-in qiladi.
 * Agar `allocate_team_number` ichidagi FOR UPDATE qulfi ishlamasa,
 * ikkita jamoa bir xil raqam oladi yoki raqam tushib qoladi.
 *
 * Skript o'z test ma'lumotini yaratadi va oxirida tozalaydi.
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const TEST_CATEGORY = "R";
const COUNT = 20;

async function main() {
  console.log(`\n${COUNT} ta parallel check-in sinovi\n`);

  // 1) Test jamoalari
  const ids: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const { rows } = await pool.query<{ id: number }>(
      `insert into teams (category_code, name, search_text)
       values ($1, $2, $3) returning id`,
      [TEST_CATEGORY, `__parallel_test_${i}`, `__parallel_test_${i}`],
    );
    ids.push(rows[0].id);
  }

  const { rows: before } = await pool.query<{ last_number: number }>(
    "select last_number from categories where code = $1",
    [TEST_CATEGORY],
  );
  const startFrom = before[0].last_number;

  // 2) Hammasini AYNI paytda ishga tushiramiz
  const started = Date.now();
  const results = await Promise.all(
    ids.map((id) =>
      pool
        .query<{ allocate_team_number: string }>(
          "select allocate_team_number($1, $2)",
          [id, "parallel-test"],
        )
        .then((r) => r.rows[0].allocate_team_number),
    ),
  );
  const elapsed = Date.now() - started;

  // 3) Tekshiruv
  const unique = new Set(results);
  const seqs = results
    .map((n) => Number(n.replace(/^\D+/, "")))
    .sort((a, b) => a - b);
  const expected = Array.from({ length: COUNT }, (_, i) => startFrom + i + 1);
  const gapless = seqs.every((value, index) => value === expected[index]);

  let failed = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (!ok) failed++;
    // Tafsilot faqat xatoda — muvaffaqiyatli qatorda u chalgʻitadi
    console.log(`  ${ok ? "ok  " : "XATO"} ${label}${!ok && detail ? " — " + detail : ""}`);
  };

  check(
    `${COUNT} ta raqamning hammasi noyob`,
    unique.size === COUNT,
    `${unique.size} ta noyob — takror bor!`,
  );
  check(
    "ketma-ketlikda boʻshliq yoʻq",
    gapless,
    `kutilgan ${expected[0]}…${expected[COUNT - 1]}, olingan ${seqs[0]}…${seqs[COUNT - 1]}`,
  );
  check(
    "idempotent: qayta chaqirsa oʻsha raqam",
    await isIdempotent(ids[0], results[ids.indexOf(ids[0])]),
  );

  console.log(`\n  ${COUNT} ta parallel check-in ${elapsed} ms da bajarildi`);
  console.log(`  Raqamlar: ${results.slice(0, 6).join(", ")} …\n`);

  // 4) Tozalash
  await pool.query("delete from teams where name like '__parallel_test_%'");
  await pool.query("update categories set last_number = $1 where code = $2", [
    startFrom,
    TEST_CATEGORY,
  ]);
  console.log("  Test maʼlumoti tozalandi.\n");

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

async function isIdempotent(teamId: number, expected: string): Promise<boolean> {
  const { rows } = await pool.query<{ allocate_team_number: string }>(
    "select allocate_team_number($1, $2)",
    [teamId, "parallel-test"],
  );
  return rows[0].allocate_team_number === expected;
}

main().catch(async (err) => {
  console.error("Sinov xatosi:", err);
  await pool.query("delete from teams where name like '__parallel_test_%'").catch(() => {});
  await pool.end();
  process.exit(1);
});
