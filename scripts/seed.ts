/**
 * Test ma'lumoti: npx tsx --env-file=.env.local scripts/seed.ts
 *
 * Bu SINOV ma'lumoti. Real musobaqada Excel importi ishlatiladi.
 * Skript idempotent: qayta ishga tushirsa avvalgi test ma'lumotini tozalab,
 * qaytadan yaratadi. Real jamoalar (walk_in yoki import qilinganlar) ham
 * o'chib ketmasligi uchun --force talab qiladi.
 */
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { CATEGORIES, CATEGORY_LIST } from "../lib/categories";
import { normalizeSearch } from "../lib/format";

const force = process.argv.includes("--force");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const SCHOOLS = [
  "Toshkent 110-maktab",
  "Toshkent 233-maktab",
  "Chilonzor IT-markazi",
  "Samarqand Prezident maktabi",
  "Buxoro 5-maktab",
  "Namangan Robotics Lab",
  "Andijon 22-maktab",
  "Farg'ona texnikumi",
  "Nukus 1-litsey",
  "Qarshi 14-maktab",
  "Robbit Yunusobod",
  "Robbit Sergeli",
];

const REGIONS = [
  "Toshkent shahri",
  "Toshkent viloyati",
  "Samarqand",
  "Buxoro",
  "Namangan",
  "Andijon",
  "Farg'ona",
  "Qoraqalpog'iston",
  "Qashqadaryo",
];

const TEAM_WORDS = [
  "Robotexniklar", "Kelajak", "Yulduz", "Temir", "Chaqmoq", "Alp", "Sherlar",
  "Burgut", "Zafar", "Olmos", "Momaqaldiroq", "Sirdaryo", "Navigator",
  "Kiberchi", "Mexanik", "Titan", "Vektor", "Impuls", "Kvant", "Orbita",
  "Bulut", "Shamol", "Uchqun", "Sardor", "Bahodir", "Metall", "Sensor",
];

const FIRST_NAMES = [
  "Xushnudbek", "Diyorbek", "Mubina", "Asadbek", "Nilufar", "Javohir",
  "Sevinch", "Islombek", "Zilola", "Ozodbek", "Malika", "Sardorbek",
  "Robiya", "Amirxon", "Gulnoza", "Doniyor", "Shahzoda", "Bekzod",
];

const LAST_NAMES = [
  "Jumaniyazov", "Toshpo'latov", "Karimova", "Rasulov", "Abdullayeva",
  "Yo'ldoshev", "Ergasheva", "Nazarov", "Qodirova", "Sattorov",
  "Umarova", "Xolmatov", "Tursunova", "Yusupov",
];

/** Deterministik tanlov — har ishga tushirishda bir xil test ma'lumoti. */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rng = makeRng(20260816);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];

/** Har yo'nalishga nechta jamoa — TZ dagi nisbat: yarmi robofutbolda */
const PLAN: Record<string, number> = { F: 24, S: 16, LS: 12, LF: 10, RC: 8 };
/** Nechtasi check-in qilinmagan holda qoldiriladi (jonli demo uchun) */
const LEAVE_UNCHECKED = 2;

async function main() {
  const client = await pool.connect();
  try {
    console.log("Test ma'lumoti yaratilmoqda...\n");

    await client.query("begin");

    // 1) Yo'nalishlar
    for (const cat of CATEGORY_LIST) {
      await client.query(
        `insert into categories (code, name, format, group_size, match_minutes, field_count)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (code) do update set name = excluded.name, format = excluded.format`,
        [
          cat.code,
          cat.name,
          cat.format,
          4,
          cat.code === "F" ? 5 : 3,
          cat.code === "F" ? 3 : 2,
        ],
      );
    }
    console.log(`  Yo'nalishlar: ${CATEGORY_LIST.length} ta`);

    // 2) Eski test ma'lumotini tozalash
    const { rows: existing } = await client.query<{ count: string }>(
      "select count(*)::text as count from teams",
    );
    if (Number(existing[0].count) > 0 && !force) {
      await client.query("rollback");
      console.error(
        `\n  Bazada allaqachon ${existing[0].count} ta jamoa bor.\n` +
          `  Ustidan yozish uchun: npx tsx --env-file=.env.local scripts/seed.ts --force\n`,
      );
      process.exit(1);
    }

    await client.query("truncate events, matches, runs, group_teams, groups, draws restart identity cascade");

    // ⚠️ `truncate teams ... cascade` YORLIQLARNI HAM o'chiradi: tags
    // jadvali teams ga bog'langan. Yorliqlar esa chop etilgan qog'ozlarga
    // mos kelishi kerak — ular hech qachon o'chirilmaydi, faqat bo'shatiladi.
    await client.query("update tags set team_id = null, assigned_at = null, assigned_by = null");
    await client.query("delete from teams");
    await client.query("alter sequence teams_id_seq restart with 1");
    await client.query("update categories set last_number = 0, draw_locked = false");
    console.log("  Eski ma'lumot tozalandi");

    // 3) Hakamlar — PIN kod bilan
    await client.query("truncate judges restart identity cascade");
    const judgePins: string[] = [];
    let pinCounter = 1000;
    for (const cat of CATEGORY_LIST) {
      const fields = cat.code === "F" ? 3 : 2;
      for (let field = 1; field <= fields; field++) {
        const pin = String(++pinCounter);
        const pinHash = await hash(pin);
        await client.query(
          `insert into judges (name, pin_hash, category_code, field_no)
           values ($1, $2, $3, $4)`,
          [`${cat.name} hakami ${field}`, pinHash, cat.code, field],
        );
        judgePins.push(`    ${cat.name} · ${field}-maydon → PIN ${pin}`);
      }
    }
    console.log(`  Hakamlar: ${judgePins.length} ta`);

    // 4) Jamoalar + ishtirokchilar
    let total = 0;
    for (const cat of CATEGORY_LIST) {
      const count = PLAN[cat.code] ?? 8;
      const uncheckedFrom = count - LEAVE_UNCHECKED;

      for (let i = 0; i < count; i++) {
        const name = `${pick(TEAM_WORDS)} ${pick(TEAM_WORDS)}`.slice(0, 40);
        const school = pick(SCHOOLS);
        const region = pick(REGIONS);
        const coach = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        const teamName = `${name} #${i + 1}`;

        const { rows } = await client.query<{ id: number }>(
          `insert into teams (category_code, name, school, region, coach, phone, search_text)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [
            cat.code,
            teamName,
            school,
            region,
            coach,
            `+9989${Math.floor(rng() * 90000000 + 10000000)}`,
            normalizeSearch(`${teamName} ${school} ${coach} ${region}`),
          ],
        );
        const teamId = rows[0].id;

        // 2–3 ishtirokchi
        const members = 2 + Math.floor(rng() * 2);
        for (let m = 0; m < members; m++) {
          await client.query(
            `insert into participants (team_id, full_name, birth_year, phone)
             values ($1, $2, $3, $4)`,
            [
              teamId,
              `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
              2008 + Math.floor(rng() * 8),
              null,
            ],
          );
        }

        // Ko'pchiligi check-in qilingan: bo'sh yorliq biriktiriladi
        if (i < uncheckedFrom) {
          const { rows: tagRows } = await client.query<{ id: number; code: string; number: number }>(
            `select id, code, number from tags
              where category_code = $1 and team_id is null
              order by number limit 1`,
            [cat.code],
          );
          if (tagRows[0]) {
            await client.query(
              `update tags set team_id = $1, assigned_at = now(), assigned_by = 'seed' where id = $2`,
              [teamId, tagRows[0].id],
            );
            await client.query(
              `update teams set number = $1, number_seq = $2, checked_in_at = now(), checked_in_by = 'seed' where id = $3`,
              [tagRows[0].code, tagRows[0].number, teamId],
            );
          }
        }
        total++;
      }
      console.log(
        `  ${cat.name}: ${count} ta jamoa (${count - LEAVE_UNCHECKED} check-in qilingan)`,
      );
    }

    await client.query("commit");

    console.log(`\nJami ${total} ta jamoa.\n`);
    console.log("  Hakam PIN kodlari:");
    console.log(judgePins.join("\n"));
    console.log("\n  Admin: .env.local dagi ADMIN_PASSWORD\n");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nSeed xatosi:", err);
  process.exit(1);
});
