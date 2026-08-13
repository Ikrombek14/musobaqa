/**
 * Migratsiyalarni qo'llash: npx tsx --env-file=.env.local scripts/migrate.ts
 *
 * drizzle-kit CLI .env.local ni o'zi o'qimaydi, shuning uchun migratsiya
 * shu skript orqali yuritiladi. Prodda ham ayni shu buyruq ishlatiladi.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL yo'q — .env.local ni tekshiring");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  // Qulf kutib qolmasin — bloklangan DDL tez xato bersin
  await pool.query("set lock_timeout = '10s'");
  await pool.query("set statement_timeout = '120s'");

  console.log("Migratsiyalar qo'llanmoqda...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Tayyor.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migratsiya xatosi:", err.message ?? err);
  process.exit(1);
});
