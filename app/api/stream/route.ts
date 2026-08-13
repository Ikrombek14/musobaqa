import { NextRequest } from "next/server";
import { currentEventId, fetchSince, subscribe, type QaraEvent } from "@/lib/realtime/bus";
import { isCategoryCode } from "@/lib/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Heartbeat — yarim ochiq ulanishni aniqlaydi va proxy timeout'ini ushlab turadi. */
const HEARTBEAT_MS = 20_000;

/**
 * SSE oqimi.
 *
 * Mijoz: new EventSource(`/api/stream?channel=R&since=<id>`)
 *
 * Uzilib qolsa brauzer o'zi qayta ulanadi va `Last-Event-ID` sarlavhasini
 * yuboradi — biz o'sha id'dan keyingi hodisalarni qaytadan beramiz.
 * Ya'ni uzilish paytida yozilgan natija yo'qolmaydi.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("channel") ?? "all";
  const channel = raw === "all" || isCategoryCode(raw) ? raw : "all";

  const lastEventHeader = request.headers.get("last-event-id");
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = Number(lastEventHeader ?? sinceParam ?? 0);
  const sinceId = Number.isFinite(since) && since > 0 ? since : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (event: QaraEvent) => {
        write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({
            id: event.id,
            type: event.type,
            channel: event.channel,
            ...event.payload,
          })}\n\n`,
        );
      };

      // Brauzerga qayta ulanish oralig'ini aytamiz
      write("retry: 2000\n\n");

      // 1) Uzilgan vaqtdagi bo'shliqni to'ldiramiz
      if (sinceId > 0) {
        try {
          /**
           * Mijozdagi id bazadagidan katta boʻlishi mumkin: baza
           * tozalangan yoki zaxiradan tiklangan. Bunday holda eski
           * kursor bilan hech narsa kelmaydi va sahifa jim qoladi —
           * shuning uchun mijozga «qaytadan yuklan» deb aytamiz.
           */
          const latest = await currentEventId();
          if (sinceId > latest) {
            write(`event: resync\ndata: {"reason":"sequence-reset"}\n\n`);
          } else {
            const missed = await fetchSince(sinceId);
            for (const event of missed) {
              if (event.channel === channel || channel === "all") send(event);
            }
          }
        } catch (err) {
          console.error("[sse] gap recovery xatosi:", (err as Error).message);
          write(`event: resync\ndata: {"reason":"error"}\n\n`);
        }
      }

      write(`event: ready\ndata: {"channel":"${channel}"}\n\n`);

      // 2) Jonli oqimga ulanamiz
      const unsubscribe = await subscribe([channel], send);

      const heartbeat = setInterval(() => {
        // Kommentariy qatori — mijozga ko'rinmaydi, lekin ulanishni tirik saqlaydi
        write(`: hb ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* allaqachon yopilgan */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx/Caddy oqimni buferlamasin — aks holda natija 30 s kechikadi
      "X-Accel-Buffering": "no",
    },
  });
}
