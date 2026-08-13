"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Bekor qilish" — 10 soniya.
 *
 * Musobaqa kunidagi eng ko'p uchraydigan xato: shoshib noto'g'ri tugmani
 * bosish. Modal bilan har safar tasdiq so'rash ishni sekinlashtiradi,
 * shuning uchun avval yoziladi, keyin qaytarish imkoni beriladi.
 */
export function UndoBar({
  label,
  seconds = 10,
  onUndo,
  onExpire,
}: {
  label: string;
  seconds?: number;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (left <= 0) {
      onExpire();
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, onExpire]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--success-soft)] px-4 py-3"
    >
      <p className="text-sm font-semibold text-[var(--success)]">{label}</p>
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={() => {
          setBusy(true);
          onUndo();
        }}
      >
        <Undo2 className="size-4" aria-hidden="true" />
        Bekor qilish
        <span className="tnum tabular-nums text-[var(--text-muted)]">{left}</span>
      </Button>
    </div>
  );
}
