"use client";

import { useActionState, useState, useTransition } from "react";
import { KeyRound, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { CATEGORIES, CATEGORY_LIST, type CategoryCode } from "@/lib/categories";
import {
  createJudge,
  deleteJudge,
  setJudgeActive,
  suggestPin,
  updateJudge,
  type JudgeState,
} from "@/server/actions/judges-admin";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import type { JudgeRow } from "@/server/queries/admin";

type Props = {
  judges: JudgeRow[];
  fieldCounts: Record<string, number>;
};

export function JudgesPanel({ judges, fieldCounts }: Props) {
  const [editing, setEditing] = useState<JudgeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; pin?: string } | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="tnum text-sm text-[var(--text-muted)]">
          Jami <span className="font-bold text-[var(--text)]">{judges.length}</span> hakam ·
          faol {judges.filter((j) => j.active).length} ta
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setEditing(null);
            setNotice(null);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Hakam qoʻshish
        </Button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-[var(--success-soft)] px-4 py-3"
        >
          <p className="text-sm font-semibold text-[var(--success)]">{notice.text}</p>
          {notice.pin && (
            <span className="tnum inline-flex items-center gap-2 rounded-md bg-[var(--surface)] px-3 py-1.5 text-lg font-bold">
              <KeyRound className="size-4 text-[var(--text-muted)]" aria-hidden="true" />
              {notice.pin}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setNotice(null)}
            aria-label="Yopish"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {notice?.pin && (
        <p className="-mt-3 text-xs text-[var(--warning)]">
          PIN faqat hozir koʻrinadi — yozib oling. Keyin faqat almashtirish mumkin.
        </p>
      )}

      {(creating || editing) && (
        <JudgeForm
          key={editing?.id ?? "new"}
          judge={editing}
          fieldCounts={fieldCounts}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(state) => {
            setCreating(false);
            setEditing(null);
            if (state.ok) setNotice({ text: state.message, pin: state.pin });
          }}
        />
      )}

      {judges.length === 0 ? (
        <Card>
          <EmptyState
            title="Hakam qoʻshilmagan"
            hint="Har maydon uchun kamida bitta hakam kerak. Hakam PIN kodi bilan kiradi va faqat oʻz maydonining oʻyinlarini koʻradi."
          />
        </Card>
      ) : (
        CATEGORY_LIST.map((category) => {
          const rows = judges.filter((j) => j.categoryCode === category.code);
          if (rows.length === 0) return null;
          return (
            <Card key={category.code} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2.5">
                <span
                  className="h-6 w-1.5 rounded-full"
                  style={{ backgroundColor: category.colorVar }}
                  aria-hidden="true"
                />
                <h2 className="text-sm font-bold">{category.name}</h2>
                <span className="tnum text-xs text-[var(--text-muted)]">
                  {rows.length} hakam · {fieldCounts[category.code] ?? 1} maydon
                </span>
              </div>

              <ul>
                {rows.map((judge) => (
                  <JudgeRowItem
                    key={judge.id}
                    judge={judge}
                    onEdit={() => {
                      setEditing(judge);
                      setCreating(false);
                      setNotice(null);
                    }}
                    onNotice={setNotice}
                  />
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}

function JudgeRowItem({
  judge,
  onEdit,
  onNotice,
}: {
  judge: JudgeRow;
  onEdit: () => void;
  onNotice: (n: { text: string } | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<JudgeState>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        onNotice({ text: result.message });
        setError(null);
      } else {
        setError(result.error);
      }
      setConfirmDelete(false);
    });

  return (
    <li className="border-b border-[var(--border)] last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className={"truncate font-medium " + (judge.active ? "" : "text-[var(--text-subtle)] line-through")}>
            {judge.name}
          </p>
          <p className="tnum text-xs text-[var(--text-muted)]">
            {judge.fieldNo ? `${judge.fieldNo}-maydon` : "Barcha maydonlar"}
            {judge.resultCount > 0 && ` · ${judge.resultCount} natija yozgan`}
          </p>
        </div>

        {!judge.active && <Badge tone="neutral">Faolsiz</Badge>}

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`${judge.name}ni tahrirlash`}>
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            onClick={() => act(() => setJudgeActive(judge.id, !judge.active))}
            aria-label={judge.active ? "Faolsiz qilish" : "Faollashtirish"}
            title={judge.active ? "Vaqtincha oʻchirish" : "Faollashtirish"}
          >
            <Power className="size-4" aria-hidden="true" />
          </Button>
          {confirmDelete ? (
            <>
              <Button
                variant="danger"
                size="sm"
                loading={pending}
                onClick={() => act(() => deleteJudge(judge.id))}
              >
                Oʻchirilsin
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Yoʻq
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              aria-label={`${judge.name}ni oʻchirish`}
              disabled={judge.resultCount > 0}
              title={
                judge.resultCount > 0
                  ? "Natija yozgan hakamni oʻchirib boʻlmaydi"
                  : undefined
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mb-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}
    </li>
  );
}

/* ============================================================
   Forma
   ============================================================ */
function JudgeForm({
  judge,
  fieldCounts,
  onClose,
  onSaved,
}: {
  judge: JudgeRow | null;
  fieldCounts: Record<string, number>;
  onClose: () => void;
  onSaved: (state: JudgeState) => void;
}) {
  const [state, formAction, pending] = useActionState<JudgeState | null, FormData>(
    async (prev, formData) => {
      const result = judge ? await updateJudge(prev, formData) : await createJudge(prev, formData);
      if (result.ok) onSaved(result);
      return result;
    },
    null,
  );

  const [categoryCode, setCategoryCode] = useState<CategoryCode>(
    (judge?.categoryCode as CategoryCode) ?? "R",
  );
  const [pin, setPin] = useState("");
  const [suggesting, startSuggest] = useTransition();

  const maxField = fieldCounts[categoryCode] ?? 1;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold">{judge ? "Hakamni tahrirlash" : "Yangi hakam"}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Yopish">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
        {judge && <input type="hidden" name="id" value={judge.id} />}

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="judge-name" className="text-sm font-medium">
            Ism familiya
          </label>
          <input
            id="judge-name"
            name="name"
            required
            defaultValue={judge?.name ?? ""}
            placeholder="Masalan: Bekzod Rasulov"
            autoComplete="off"
            className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="judge-category" className="text-sm font-medium">
            Yoʻnalish
          </label>
          <select
            id="judge-category"
            name="categoryCode"
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value as CategoryCode)}
            className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          >
            {CATEGORY_LIST.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="judge-field" className="text-sm font-medium">
            Maydon
          </label>
          <select
            id="judge-field"
            name="fieldNo"
            defaultValue={judge?.fieldNo === null ? "all" : String(judge?.fieldNo ?? 1)}
            className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          >
            {Array.from({ length: maxField }, (_, i) => i + 1).map((field) => (
              <option key={field} value={field}>
                {field}-maydon
              </option>
            ))}
            <option value="all">Barcha maydonlar (bosh hakam)</option>
          </select>
          <p className="text-xs text-[var(--text-muted)]">
            {CATEGORIES[categoryCode].name}da {maxField} ta maydon sozlangan
          </p>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="judge-pin" className="text-sm font-medium">
            PIN kod
            {judge && (
              <span className="ml-1 text-xs font-normal text-[var(--text-subtle)]">
                boʻsh qoldirilsa oʻzgarmaydi
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              id="judge-pin"
              name="pin"
              inputMode="numeric"
              required={!judge}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="4–8 raqam"
              autoComplete="off"
              className="tnum h-11 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base tracking-widest outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
            />
            <Button
              type="button"
              variant="secondary"
              loading={suggesting}
              onClick={() => startSuggest(async () => setPin(await suggestPin()))}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              Taklif
            </Button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            PIN noyob boʻlishi shart — kirishda hakamni aynan shu kod aniqlaydi.
          </p>
        </div>

        {state?.ok === false && (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)] sm:col-span-2"
          >
            {state.error}
          </p>
        )}

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={pending}>
            {judge ? "Saqlash" : "Qoʻshish"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Bekor
          </Button>
        </div>
      </form>
    </Card>
  );
}
