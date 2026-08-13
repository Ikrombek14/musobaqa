import "server-only";
import { Pool, types } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * int8 (bigint) → JS number.
 *
 * node-postgres standart holatda `bigint` ni STRING qilib qaytaradi —
 * chunki 64-bit son JS `number` ga sigʻmasligi mumkin. Bizning barcha
 * id'larimiz `bigserial`, ya'ni 1 dan boshlanadi va hech qachon
 * 9·10¹⁵ (Number.MAX_SAFE_INTEGER) ga yaqinlashmaydi.
 *
 * Buni sozlamasak, xom SQL (`db.execute`) qaytargan har bir id string
 * boʻlib keladi va `Number.isInteger(id)` tekshiruvlari qulaydi. Aynan
 * shu sabab check-in'da «Notoʻgʻri jamoa» xatosi chiqqan edi.
 * Drizzle'ning tipli `select` lari id'ni oʻzi parse qiladi, shuning uchun
 * xato faqat xom SQL da koʻrinib, sinovlardan sirgʻalib oʻtgan.
 *
 * Global parser butun sinf xatoni yopadi: endi id qayerdan kelishidan
 * qatʼi nazar number boʻladi.
 */
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

/**
 * Bitta pool butun ilova uchun. Dev rejimda HMR har safar modulni qayta
 * yuklaydi — globalThis'da saqlamasak, o'nlab pool ochilib ketadi va
 * Postgres "too many connections" bilan yiqiladi.
 *
 * Realtime LISTEN uchun ALOHIDA ulanish ishlatiladi (lib/realtime/bus.ts) —
 * u pool'dan olinmaydi, chunki LISTEN ulanishni band qilib turadi.
 */
const globalForDb = globalThis as unknown as {
  qaraPool?: Pool;
};

export const pool =
  globalForDb.qaraPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Uzoq ketgan so'rov butun tizimni ushlab qolmasin
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });

if (env.NODE_ENV !== "production") globalForDb.qaraPool = pool;

pool.on("error", (err) => {
  console.error("[db] pool xatosi:", err.message);
});

export const db = drizzle(pool, { schema });

export { schema };
