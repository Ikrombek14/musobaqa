"use client";

import { useEffect, useRef, useState } from "react";

export type LiveStatus = "connecting" | "live" | "offline";

export type LiveEvent = {
  id: number;
  type: string;
  channel: string;
} & Record<string, unknown>;

/**
 * SSE oqimiga ulanadi.
 *
 * EventSource uzilishda o'zi qayta ulanadi va `Last-Event-ID` ni yuboradi,
 * shuning uchun bu yerda qo'lda reconnect sikli yozilmagan — brauzerniki
 * yetarli va u jitter bilan ishlaydi.
 *
 * `onEvent` har hodisada chaqiriladi. Uni `useCallback` ga o'rash SHART EMAS:
 * ref orqali ushlanadi, ya'ni funksiya o'zgarishi ulanishni uzmaydi.
 */
export function useLive(
  channel: string,
  sinceId: number,
  onEvent: (event: LiveEvent) => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const url = `/api/stream?channel=${encodeURIComponent(channel)}&since=${sinceId}`;
    const source = new EventSource(url);

    const onMessage = (e: MessageEvent) => {
      try {
        handler.current(JSON.parse(e.data) as LiveEvent);
      } catch {
        /* noto'g'ri kadr — tashlab yuboramiz */
      }
    };

    // Server `event:` nomi bilan yuboradi, shuning uchun har turga alohida listener
    const types = [
      "match.updated",
      "match.reverted",
      "run.saved",
      "run.reverted",
      "team.checked_in",
      "draw.completed",
      "draw.cancelled",
    ];
    for (const type of types) source.addEventListener(type, onMessage);

    source.addEventListener("ready", () => setStatus("live"));
    source.addEventListener("resync", () => window.location.reload());
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus((s) => (s === "live" ? "connecting" : "offline"));

    return () => {
      for (const type of types) source.removeEventListener(type, onMessage);
      source.close();
    };
    // sinceId faqat birinchi ulanish uchun — o'zgarganda qayta ulanmaymiz
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  return status;
}
