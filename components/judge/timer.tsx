"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatMs } from "@/lib/format";

/**
 * Taymer.
 *
 * Vaqt `Date.now()` farqidan hisoblanadi, interval sanog'idan emas —
 * brauzer tabni sekinlashtirsa ham (fon rejim, zaif noutbuk) o'lchov
 * to'g'ri qoladi. Ekran 50 ms da bir yangilanadi, bu ko'z uchun yetarli.
 */
export function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const accumulated = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      setElapsed(accumulated.current + (Date.now() - (startedAt.current ?? Date.now())));
    };
    tick();
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback(() => {
    if (running) return;
    startedAt.current = Date.now();
    setRunning(true);
  }, [running]);

  const stop = useCallback(() => {
    if (!running) return;
    accumulated.current += Date.now() - (startedAt.current ?? Date.now());
    startedAt.current = null;
    setElapsed(accumulated.current);
    setRunning(false);
  }, [running]);

  const reset = useCallback(() => {
    accumulated.current = 0;
    startedAt.current = null;
    setElapsed(0);
    setRunning(false);
  }, []);

  const setManual = useCallback((ms: number) => {
    accumulated.current = ms;
    setElapsed(ms);
  }, []);

  return { elapsed, running, start, stop, reset, setManual };
}

export function TimerDisplay({ ms, running }: { ms: number; running: boolean }) {
  return (
    <div
      className="tnum text-center text-5xl font-bold tracking-tight sm:text-6xl"
      style={{ color: running ? "var(--success)" : "var(--text)" }}
      role="timer"
      aria-live="off"
    >
      {formatMs(ms)}
    </div>
  );
}
