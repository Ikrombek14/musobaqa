/**
 * Yorliq biriktirishning poyga holatiga chidamliligini tekshiradi:
 *   npx tsx --env-file=.env.local scripts/verify-numbering.ts
 *
 * Raqam endi avtomatik berilmaydi — admin chop etilgan yorliqni
 * jamoaga biriktiradi. Xavf: ikki stol bir vaqtda AYNI kodni kiritsa.
 * `for update` qulfi ishlamasa bitta yorliq ikki jamoaga tegib ketadi.
 *
 * Skript o'z test ma'lumotini yaratadi va oxirida tozalaydi.
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const TEST_CATEGORY = "F";
const COUNT = 20;

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "XATO"} ${label}${!ok && detail ? " — " + detail : ""}`);
}

/** assignTag ichidagi mantiqning aynan o'zi — bitta tranzaksiyada. */
async function claimTag(teamId: number, code: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: number; team_id: number | null; number: number }>(
      `select id, team_id, number from tags
        where category_code = $1 and code = $2 for update`,
      [TEST_CATEGORY, code],
    );
    const tag = rows[0];
    if (!tag) throw new Error("yorliq yo'q");

    if (tag.team_id !== null && tag.team_id !== teamId) {
      await client.query("rollback");
      return null; // band
    }

    await client.query(
      `update tags set team_id = $1, assigned_at = now(), assigned_by = 'sinov' where id = $2`,
      [teamId, tag.id],
    );
    await client.query(
      `update teams set number = $1, number_seq = $2, checked_in_at = now() where id = $3`,
      [code, tag.number, teamId],
    );
    await client.query("commit");
    return code;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`\nYorliq biriktirish — ${COUNT} ta parallel sinov\n`);

  // Test jamoalari
  const ids: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const { rows } = await pool.query<{ id: number }>(
      `insert into teams (category_code, name, search_text)
       values ($1, $2, $3) returning id`,
      [TEST_CATEGORY, `__tag_test_${i}`, `__tag_test_${i}`],
    );
    ids.push(rows[0].id);
  }

  // Sinov uchun bo'sh yorliqlar
  const { rows: freeTags } = await pool.query<{ code: string }>(
    `select code from tags
      where category_code = $1 and team_id is null
      order by number limit $2`,
    [TEST_CATEGORY, COUNT],
  );
  if (freeTags.length < COUNT) {
    console.error(`Bo'sh yorliq yetarli emas (${freeTags.length}/${COUNT})`);
    process.exit(1);
  }

  /* --- 1. Har biriga alohida kod: hammasi muvaffaqiyatli bo'lishi kerak --- */
  const started = Date.now();
  const results = await Promise.all(
    ids.map((id, i) => claimTag(id, freeTags[i].code)),
  );
  const elapsed = Date.now() - started;

  const assigned = results.filter((r) => r !== null);
  check(
    `${COUNT} ta alohida yorliq biriktirildi`,
    assigned.length === COUNT,
    `${assigned.length} ta`,
  );
  check("kodlar takrorlanmadi", new Set(assigned).size === COUNT);

  /* --- 2. Bitta kodga 10 ta parallel urinish: faqat bittasi o'tsin --- */
  const { rows: contested } = await pool.query<{ code: string }>(
    `select code from tags where category_code = $1 and team_id is null order by number limit 1`,
    [TEST_CATEGORY],
  );
  if (contested[0]) {
    const contestIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into teams (category_code, name, search_text)
         values ($1, $2, $3) returning id`,
        [TEST_CATEGORY, `__tag_race_${i}`, `__tag_race_${i}`],
      );
      contestIds.push(rows[0].id);
    }

    const raceResults = await Promise.all(
      contestIds.map((id) => claimTag(id, contested[0].code).catch(() => null)),
    );
    const winners = raceResults.filter((r) => r !== null);
    check(
      `bitta kodga 10 ta urinish → faqat 1 tasi o'tdi`,
      winners.length === 1,
      `${winners.length} tasi o'tdi — yorliq ikki jamoaga tegdi!`,
    );

    const { rows: holders } = await pool.query<{ count: string }>(
      `select count(*)::text as count from teams where number = $1`,
      [contested[0].code],
    );
    check(
      "bazada ham bitta jamoada",
      holders[0].count === "1",
      `${holders[0].count} ta jamoada`,
    );
  }

  console.log(`\n  ${COUNT} ta parallel biriktirish ${elapsed} ms da bajarildi`);
  console.log(`  Kodlar: ${assigned.slice(0, 6).join(", ")} …\n`);

  // Tozalash
  await pool.query(
    `update tags set team_id = null, assigned_at = null, assigned_by = null
      where team_id in (select id from teams where name like '__tag_%')`,
  );
  await pool.query("delete from teams where name like '__tag_%'");
  console.log("  Test ma'lumoti tozalandi.\n");

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Sinov xatosi:", err);
  await pool.query("delete from teams where name like '__tag_%'").catch(() => {});
  await pool.end();
  process.exit(1);
});
