import "server-only";
import { Client } from "pg";
import { env } from "@/lib/env";
import { pool } from "@/lib/db";

/**
 * Realtime yadro.
 *
 * Zanjir:  hakam yozadi → events jadvaliga qator → Postgres trigger NOTIFY
 *          → shu yerdagi BITTA LISTEN ulanishi → jarayon ichida fan-out
 *          → SSE orqali barcha ulangan brauzerlarga.
 *
 * Muhim qarorlar:
 *  • LISTEN uchun alohida Client (pool'dan emas) — LISTEN ulanishni band qiladi.
 *  • Har bir SSE mijoz uchun Postgres ulanishi OCHILMAYDI. 300 ta tomoshabin
 *    bo'lsa ham bazaga ulanish soni bitta bo'lib qoladi — "qotish"ning
 *    eng ko'p uchraydigan sababi shu yerda yopilgan.
 *  • NOTIFY faqat id olib keladi; qatorlar 100 ms lik tick'da bitta SELECT
 *    bilan to'plamda o'qiladi (coalescing). 5 hakam bir vaqtda yozsa ham
 *    tabloga soniyasiga 10 martadan ko'p push ketmaydi.
 */

export type QaraEvent = {
  id: number;
  channel: string;
  type: string;
  payload: Record<string, unknown>;
};

type Subscriber = {
  channels: Set<string>;
  push: (event: QaraEvent) => void;
};

type Bus = {
  subscribers: Set<Subscriber>;
  lastId: number;
  dirty: boolean;
  client: Client | null;
  timer: NodeJS.Timeout | null;
  starting: Promise<void> | null;
  retry: number;
};

const CHANNEL = "qara_events";
const TICK_MS = 100;

const globalForBus = globalThis as unknown as { qaraBus?: Bus };

const bus: Bus =
  globalForBus.qaraBus ??
  {
    subscribers: new Set<Subscriber>(),
    lastId: 0,
    dirty: false,
    client: null,
    timer: null,
    starting: null,
    retry: 0,
  };

globalForBus.qaraBus = bus;

/* ------------------------------------------------------------------ */
/* LISTEN ulanishi                                                      */
/* ------------------------------------------------------------------ */

async function connectListener(): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL) return;
    bus.dirty = true;

    /**
     * Ketma-ketlik orqaga ketganini aniqlaymiz.
     *
     * `events` jadvali `truncate ... restart identity` bilan tozalansa
     * yoki baza zaxiradan tiklansa, yangi qatorlar id = 1 dan boshlanadi.
     * Bizning kursorimiz esa eski katta qiymatda qolib ketadi va
     * `id > lastId` sharti hech qachon bajarilmaydi — natijada tizim
     * JIM QOLADI: hakam yozadi, tabloda hech narsa oʻzgarmaydi.
     *
     * Bu — musobaqa kunida bazani qayta tiklashda yuz berishi mumkin
     * boʻlgan eng xavfli holat, shuning uchun oʻzini oʻzi tuzatadi.
     */
    try {
      const payload = JSON.parse(msg.payload ?? "{}") as { id?: number };
      if (typeof payload.id === "number" && payload.id <= bus.lastId) {
        console.warn(
          `[realtime] events ketma-ketligi qayta boshlangan (${bus.lastId} → ${payload.id}), kursor tiklandi`,
        );
        bus.lastId = payload.id - 1;
      }
    } catch {
      /* payload buzilgan — tick baribir yangi qatorlarni oʻqiydi */
    }
  });

  client.on("error", (err) => {
    console.error("[realtime] LISTEN ulanish xatosi:", err.message);
    void reconnect();
  });

  client.on("end", () => {
    if (bus.client === client) void reconnect();
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);

  bus.client = client;
  bus.retry = 0;

  // Ulangan payt holatidan boshlaymiz — eski hodisalar qayta tarqatilmasin.
  if (bus.lastId === 0) {
    const { rows } = await pool.query<{ max: string | null }>(
      "select max(id)::text as max from events",
    );
    bus.lastId = Number(rows[0]?.max ?? 0);
  } else {
    // Uzilib qolgan vaqtdagi hodisalarni qo'ldan chiqarmaymiz.
    bus.dirty = true;
  }

  console.log("[realtime] LISTEN faol, lastId =", bus.lastId);
}

async function reconnect(): Promise<void> {
  const dead = bus.client;
  bus.client = null;
  bus.starting = null;
  try {
    await dead?.end();
  } catch {
    /* allaqachon yopilgan */
  }

  // Eksponensial kechikish + to'liq jitter (thundering herd bo'lmasin)
  const attempt = Math.min(++bus.retry, 6);
  const ceiling = Math.min(30_000, 250 * 2 ** attempt);
  const delay = Math.random() * ceiling;
  setTimeout(() => void ensureStarted(), delay);
}

async function ensureStarted(): Promise<void> {
  if (bus.client) return;
  if (bus.starting) return bus.starting;

  bus.starting = connectListener()
    .catch((err) => {
      console.error("[realtime] ulanib boʻlmadi:", (err as Error).message);
      bus.starting = null;
      void reconnect();
    })
    .then(() => {
      bus.starting = null;
    });

  if (!bus.timer) {
    bus.timer = setInterval(() => void drain(), TICK_MS);
    // Tick tugash uchun jarayonni ushlab turmasin
    bus.timer.unref?.();
  }

  return bus.starting;
}

/* ------------------------------------------------------------------ */
/* Tick: yangi qatorlarni o'qib, obunachilarga tarqatish                */
/* ------------------------------------------------------------------ */

let draining = false;

async function drain(): Promise<void> {
  if (!bus.dirty || draining) return;
  if (bus.subscribers.size === 0) {
    // Hech kim tinglamayotgan bo'lsa ham kursorni oldinga suramiz,
    // aks holda birinchi ulangan mijozga eski hodisalar to'planib tushadi.
    bus.dirty = false;
    const { rows } = await pool.query<{ max: string | null }>(
      "select max(id)::text as max from events",
    );
    bus.lastId = Number(rows[0]?.max ?? bus.lastId);
    return;
  }

  draining = true;
  bus.dirty = false;

  try {
    const events = await fetchSince(bus.lastId, 500);
    if (events.length === 0) return;

    bus.lastId = events[events.length - 1].id;

    for (const event of events) {
      for (const sub of bus.subscribers) {
        if (sub.channels.has(event.channel) || sub.channels.has("all")) {
          try {
            sub.push(event);
          } catch {
            bus.subscribers.delete(sub);
          }
        }
      }
    }
  } catch (err) {
    console.error("[realtime] drain xatosi:", (err as Error).message);
    bus.dirty = true; // keyingi tick'da qayta urinadi
  } finally {
    draining = false;
  }
}

/** Uzilgan mijoz uchun: id'dan keyingi hodisalar (gap recovery). */
export async function fetchSince(sinceId: number, limit = 500): Promise<QaraEvent[]> {
  const { rows } = await pool.query<{
    id: string;
    channel: string;
    type: string;
    payload: Record<string, unknown>;
  }>(
    `select id::text, channel, type, payload
       from events
      where id > $1
      order by id
      limit $2`,
    [sinceId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    channel: r.channel,
    type: r.type,
    payload: r.payload,
  }));
}

export async function currentEventId(): Promise<number> {
  const { rows } = await pool.query<{ max: string | null }>(
    "select max(id)::text as max from events",
  );
  return Number(rows[0]?.max ?? 0);
}

/* ------------------------------------------------------------------ */
/* Obuna                                                                */
/* ------------------------------------------------------------------ */

export async function subscribe(
  channels: string[],
  push: (event: QaraEvent) => void,
): Promise<() => void> {
  await ensureStarted();
  const sub: Subscriber = { channels: new Set(channels), push };
  bus.subscribers.add(sub);
  return () => {
    bus.subscribers.delete(sub);
  };
}

export function subscriberCount(): number {
  return bus.subscribers.size;
}
