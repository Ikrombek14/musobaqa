"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sahifalar boʻylab avtomatik aylanish.
 *
 * Bitta panelga hamma narsa sigʻmaydi: robofutbolda 7 ta guruh,
 * linefollowerda 18 ta jamoa. Ekran oldida turgan odam bir necha
 * daqiqada hammasini koʻrib chiqishi kerak.
 *
 * Almashish `position:absolute` bilan ustma-ust qoʻyish orqali EMAS —
 * bitta konteynerda `opacity` + `transform` bilan. Absolute qoʻysak
 * panel balandligi kontentga bogʻliq boʻlib qolardi va qatorlar soni
 * har xil guruhlarda panel sakrardi.
 *
 * Bitta sahifa boʻlsa aylanish umuman ishga tushmaydi.
 */
export function useRotation(pageCount: number, intervalMs = 8000) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Sahifalar soni oʻzgarsa (yangi guruh qoʻshildi) — boshidan
    setIndex((current) => (current < pageCount ? current : 0));
  }, [pageCount]);

  useEffect(() => {
    if (pageCount <= 1) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const cycle = setInterval(() => {
      if (reduced) {
        setIndex((i) => (i + 1) % pageCount);
        return;
      }
      // Avval xiralashadi, keyin kontent almashadi — sakrash boʻlmaydi
      setFading(true);
      const swap = setTimeout(() => {
        setIndex((i) => (i + 1) % pageCount);
        setFading(false);
      }, 400);
      timers.current.push(swap);
    }, intervalMs);

    return () => {
      clearInterval(cycle);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [pageCount, intervalMs]);

  return { index: pageCount > 0 ? index % pageCount : 0, fading };
}

/** Sahifa nuqtalari — nechta sahifa bor va qaysi biri turibdi. */
export function Dots({ count, active }: { count: number; active: number }) {
  if (count <= 1) return null;
  return (
    <span className="tb-dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} data-on={i === active ? "true" : undefined} />
      ))}
    </span>
  );
}
