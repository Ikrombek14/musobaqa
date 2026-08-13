"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { adminLogin, type LoginState } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" block loading={pending}>
      Kirish
    </Button>
  );
}

export function AdminLogin() {
  const [state, formAction] = useActionState<LoginState, FormData>(adminLogin, {});

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4">
      <Card className="w-full p-6 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-soft)]">
            <ShieldCheck className="size-6 text-[var(--warning)]" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold">Admin panelga kirish</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Roʻyxatdan oʻtkazish stoli va tashkilotchilar uchun.
          </p>
        </div>

        <form action={formAction} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Ismingiz
            </label>
            <input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Masalan: Dilshod"
              className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none transition-shadow focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
            />
            <p className="text-xs text-[var(--text-muted)]">
              Auditda kim nima qilgani shu ism bilan yoziladi.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Parol
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              aria-describedby={state.error ? "login-error" : undefined}
              aria-invalid={state.error ? true : undefined}
              className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none transition-shadow focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
            />
          </div>

          {state.error && (
            <p
              id="login-error"
              role="alert"
              className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
            >
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </Card>
    </div>
  );
}
