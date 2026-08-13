"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from "lucide-react";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import {
  FIELD_LABELS,
  prepareRows,
  type FieldKey,
  type ImportRow,
  type Mapping,
} from "@/lib/import-mapping";
import {
  commitImport,
  parseImportFile,
  type CommitResult,
  type ParseResult,
} from "@/server/actions/import";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";

type Parsed = Extract<ParseResult, { ok: true }>;

export function ImportScreen() {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CommitResult, { ok: true }> | null>(null);
  const [uploading, startUpload] = useTransition();
  const [saving, startSave] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(
    () => (parsed && mapping ? prepareRows(parsed.rows, mapping) : []),
    [parsed, mapping],
  );

  const good = preview.filter((t) => t.problem === null);
  const bad = preview.filter((t) => t.problem !== null);

  const byCategory = useMemo(() => {
    const map = new Map<CategoryCode, number>();
    for (const team of good) {
      if (!team.categoryCode) continue;
      map.set(team.categoryCode, (map.get(team.categoryCode) ?? 0) + 1);
    }
    return [...map.entries()];
  }, [good]);

  const upload = (file: File) => {
    setError(null);
    setDone(null);
    startUpload(async () => {
      const form = new FormData();
      form.set("file", file);
      const result = await parseImportFile(form);
      if (result.ok) {
        setParsed(result);
        setMapping(result.mapping);
      } else {
        setError(result.error);
        setParsed(null);
        setMapping(null);
      }
    });
  };

  const reset = () => {
    setParsed(null);
    setMapping(null);
    setError(null);
    setDone(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /* ---------------- Yakun ---------------- */
  if (done) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-[var(--success-soft)]">
            <CheckCircle2 className="size-6 text-[var(--success)]" aria-hidden="true" />
          </span>
          <h2 className="text-xl font-bold">Import tugadi</h2>
          <p className="tnum text-[var(--text-muted)]">
            <span className="font-bold text-[var(--text)]">{done.created}</span> ta jamoa
            qoʻshildi
            {done.skipped > 0 && ` · ${done.skipped} ta takror oʻtkazib yuborildi`}
            {done.problems > 0 && ` · ${done.problems} ta qator xatolik bilan`}
          </p>
          <p className="max-w-[52ch] text-sm text-[var(--text-muted)]">
            Jamoalarga raqam <strong>hozir berilmadi</strong> — raqam check-in paytida
            beriladi, shunda kelmagan jamoa raqamni band qilmaydi.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => router.push("/admin/jamoalar")}>
              Jamoalar roʻyxati
            </Button>
            <Button variant="secondary" onClick={reset}>
              Yana import qilish
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  /* ---------------- 1-qadam: fayl ---------------- */
  if (!parsed || !mapping) {
    return (
      <div className="flex flex-col gap-4">
        <Card
          className="p-8"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
          }}
        >
          <EmptyState
            icon={<FileSpreadsheet className="size-8" />}
            title="Excel faylni tanlang yoki shu yerga tashlang"
            hint="Birinchi qator — ustun sarlavhalari. Keyingi qadamda qaysi ustun nimaga mos kelishini oʻzingiz tasdiqlaysiz. .xlsx va .csv qabul qilinadi."
            action={
              <>
                <input
                  ref={inputRef}
                  id="import-file"
                  type="file"
                  accept=".xlsx,.csv"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(file);
                  }}
                />
                <Button
                  variant="primary"
                  size="lg"
                  loading={uploading}
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  Fayl tanlash
                </Button>
              </>
            }
          />
        </Card>

        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  /* ---------------- 2-qadam: moslash + preview ---------------- */
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <FileSpreadsheet className="size-5 text-[var(--text-muted)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{parsed.fileName}</p>
          <p className="tnum text-sm text-[var(--text-muted)]">
            «{parsed.sheetName}» varagʻi · {parsed.rows.length} qator ·{" "}
            {parsed.headers.length} ustun
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <X className="size-4" aria-hidden="true" />
          Boshqa fayl
        </Button>
      </Card>

      {/* Ustunlarni moslash */}
      <Card className="p-5">
        <h2 className="font-bold">Ustunlarni moslash</h2>
        <p className="mt-1 max-w-[75ch] text-sm text-[var(--text-muted)]">
          Tizim sarlavhalar boʻyicha taxmin qildi — tekshirib chiqing.
          <strong> Yoʻnalish</strong> majburiy. Jamoa nomi boʻsh boʻlsa birinchi
          ishtirokchi ismi olinadi.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            ["categoryCode", "name", "school", "region", "coach", "phone"] as FieldKey[]
          ).map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <label htmlFor={`map-${field}`} className="text-sm font-medium">
                {FIELD_LABELS[field]}
                {field === "categoryCode" && (
                  <span className="ml-1 text-[var(--danger)]">*</span>
                )}
              </label>
              <select
                id={`map-${field}`}
                value={String((mapping[field as keyof Mapping] as number | null) ?? "")}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    [field]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="h-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
              >
                <option value="">— yoʻq —</option>
                {parsed.headers.map((header, index) => (
                  <option key={index} value={index}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {/* Ishtirokchilar — bir nechta ustun boʻlishi mumkin */}
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">
            Ishtirokchilar
            <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
              bir nechta ustunni belgilash mumkin
            </span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {parsed.headers.map((header, index) => {
              const active = mapping.members.includes(index);
              return (
                <label
                  key={index}
                  className={
                    "cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
                    (active
                      ? "bg-[var(--text)] text-[var(--bg)]"
                      : "bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]")
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={active}
                    onChange={() =>
                      setMapping({
                        ...mapping,
                        members: active
                          ? mapping.members.filter((i) => i !== index)
                          : [...mapping.members, index].sort((a, b) => a - b),
                      })
                    }
                  />
                  {header}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Bitta katakda bir nechta ism boʻlsa (vergul, nuqta-vergul yoki yangi qator
            bilan ajratilgan) — ular avtomatik boʻlinadi.
          </p>
        </fieldset>
      </Card>

      {/* Xulosa */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Qoʻshiladi
          </p>
          <p className="tnum mt-1 text-3xl font-bold">{good.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Xatolik bilan
          </p>
          <p
            className="tnum mt-1 text-3xl font-bold"
            style={bad.length > 0 ? { color: "var(--warning)" } : undefined}
          >
            {bad.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Yoʻnalishlar
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {byCategory.length === 0 ? (
              <span className="text-sm text-[var(--text-muted)]">—</span>
            ) : (
              byCategory.map(([code, count]) => (
                <span
                  key={code}
                  className="tnum inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: CATEGORIES[code].colorVar }}
                >
                  {CATEGORIES[code].name} {count}
                </span>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Xatoliklar */}
      {bad.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--warning-soft)] px-4 py-2.5">
            <AlertTriangle className="size-4 text-[var(--warning)]" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[var(--warning)]">
              {bad.length} ta qator import qilinmaydi
            </h2>
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {bad.slice(0, 50).map((team) => (
              <li
                key={team.rowNumber}
                className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm last:border-0"
              >
                <span className="tnum w-12 shrink-0 text-[var(--text-subtle)]">
                  {team.rowNumber}-q
                </span>
                <span className="min-w-0 flex-1 truncate">{team.name || "—"}</span>
                <span className="shrink-0 text-[var(--warning)]">{team.problem}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Preview */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2.5">
          <h2 className="text-sm font-bold">Koʻrib chiqish</h2>
          <span className="tnum text-xs text-[var(--text-muted)]">
            birinchi {Math.min(good.length, 20)} ta
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-xs font-semibold text-[var(--text-muted)]">
                <th scope="col" className="w-14 py-2 pl-4 text-left">
                  Qator
                </th>
                <th scope="col" className="w-32 text-left">
                  Yoʻnalish
                </th>
                <th scope="col" className="text-left">
                  Jamoa
                </th>
                <th scope="col" className="text-left">
                  Ishtirokchilar
                </th>
                <th scope="col" className="w-40 pr-4 text-left">
                  Maktab
                </th>
              </tr>
            </thead>
            <tbody>
              {good.slice(0, 20).map((team) => (
                <tr key={team.rowNumber} className="border-t border-[var(--border)]">
                  <td className="tnum py-2 pl-4 text-[var(--text-subtle)]">
                    {team.rowNumber}
                  </td>
                  <td>
                    {team.categoryCode && (
                      <Badge tone="neutral">{CATEGORIES[team.categoryCode].name}</Badge>
                    )}
                  </td>
                  <td className="font-medium">
                    <span className="line-clamp-1">{team.name}</span>
                  </td>
                  <td className="text-[var(--text-muted)]">
                    <span className="line-clamp-1">
                      {team.members.join(", ") || "—"}
                    </span>
                  </td>
                  <td className="pr-4 text-[var(--text-muted)]">
                    <span className="line-clamp-1">{team.school ?? "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="lg"
          loading={saving}
          disabled={good.length === 0}
          onClick={() =>
            startSave(async () => {
              setError(null);
              const result = await commitImport(parsed.rows, mapping);
              if (result.ok) setDone(result);
              else setError(result.error);
            })
          }
        >
          {good.length} ta jamoani qoʻshish
        </Button>
        <Button variant="ghost" size="lg" onClick={reset} disabled={saving}>
          Bekor qilish
        </Button>
      </div>
    </div>
  );
}
