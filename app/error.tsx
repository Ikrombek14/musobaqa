"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Xato ekrani. Musobaqa kuni eng muhimi — nima qilish kerakligi yozilgan
 * boʻlsin va bitta bosishda qayta urinib koʻrish mumkin boʻlsin.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] xato:", error);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <h1 className="text-xl font-bold">Nimadir notoʻgʻri ketdi</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Sahifani qayta yuklab koʻring. Muammo takrorlansa tashkilotchiga ayting —
        yozilgan natijalar bazada saqlanib qoladi.
      </p>
      <Button variant="primary" onClick={reset}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Qayta urinish
      </Button>
      {error.digest && (
        <p className="font-mono text-xs text-[var(--text-subtle)]">kod: {error.digest}</p>
      )}
    </main>
  );
}
