"use client";

import { useActionState, useState } from "react";
import { Delete, Gavel } from "lucide-react";
import { judgeLogin, type ActionResult } from "@/server/actions/judge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

/**
 * PIN klaviaturasi.
 *
 * Telefonda ham, noutbukda ham ishlaydi: katta tugmalar (44px dan katta)
 * va oddiy klaviatura kiritishi ham qabul qilinadi.
 */
export function PinLogin() {
  const [pin, setPin] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    judgeLogin,
    { ok: true },
  );

  const press = (digit: string) => setPin((p) => (p.length < 8 ? p + digit : p));

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-sm items-center px-4">
      <Card className="w-full p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-soft)]">
            <Gavel className="size-6 text-[var(--warning)]" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold">Hakam paneli</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Sizga berilgan PIN kodni kiriting
          </p>
        </div>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <label htmlFor="pin" className="sr-only">
            PIN kod
          </label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            aria-invalid={state.ok === false ? true : undefined}
            aria-describedby={state.ok === false ? "pin-error" : undefined}
            className="tnum h-14 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-center text-3xl tracking-[0.4em] outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
          />

          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <Button
                key={digit}
                type="button"
                variant="secondary"
                size="xl"
                onClick={() => press(digit)}
                className="text-2xl"
              >
                {digit}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="xl"
              onClick={() => setPin("")}
              aria-label="Tozalash"
            >
              C
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xl"
              onClick={() => press("0")}
              className="text-2xl"
            >
              0
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xl"
              onClick={() => setPin((p) => p.slice(0, -1))}
              aria-label="Oxirgi raqamni oʻchirish"
            >
              <Delete className="size-5" aria-hidden="true" />
            </Button>
          </div>

          {state.ok === false && (
            <p
              id="pin-error"
              role="alert"
              className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-center text-sm font-medium text-[var(--danger)]"
            >
              {state.error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={pending}
            disabled={pin.length < 4}
          >
            Kirish
          </Button>
        </form>
      </Card>
    </div>
  );
}
