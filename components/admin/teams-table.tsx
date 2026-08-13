"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Camera,
  Download,
  Pencil,
  Search,
  Trash2,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useLive } from "@/lib/realtime/use-live";
import { CATEGORIES, CATEGORY_LIST, isCategoryCode } from "@/lib/categories";
import { formatTime } from "@/lib/format";
import {
  deleteTeam,
  exportTeamsCsv,
  undoCheckIn,
  updateTeam,
  type TeamActionState,
} from "@/server/actions/teams";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, LiveDot, TeamNumber } from "@/components/ui/primitives";
import type { AdminTeam } from "@/server/queries/teams";

type Props = {
  teams: AdminTeam[];
  sinceId: number;
  totals: { all: number; checked: number };
};

export function TeamsTable({ teams, sinceId, totals }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<AdminTeam | null>(null);
  const [notice, setNotice] = useState<TeamActionState | null>(null);

  // Check-in real vaqtda tushib tursin
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = useLive("all", sinceId, (event) => {
    if (event.type !== "team.checked_in") return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
    }, 500);
  });

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  const category = params.get("category") ?? "all";
  const statusFilter = params.get("status") ?? "all";
  const query = params.get("q") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    router.replace(`/admin/jamoalar?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filtrlar — URL da saqlanadi, ulashsa ham ochiladi */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={query} onChange={(v) => setParam("q", v)} />

        <div className="flex flex-wrap gap-1">
          <FilterChip
            active={category === "all"}
            onClick={() => setParam("category", "all")}
            label="Hammasi"
          />
          {CATEGORY_LIST.map((cat) => (
            <FilterChip
              key={cat.code}
              active={category === cat.code}
              onClick={() => setParam("category", cat.code)}
              label={cat.name}
              color={cat.colorVar}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setParam("status", "all")}
            label="Barcha holat"
          />
          <FilterChip
            active={statusFilter === "checked"}
            onClick={() => setParam("status", "checked")}
            label="Keldi"
          />
          <FilterChip
            active={statusFilter === "waiting"}
            onClick={() => setParam("status", "waiting")}
            label="Kutilmoqda"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <LiveDot status={status} />
          <ExportButton />
        </div>
      </div>

      <p className="tnum text-sm text-[var(--text-muted)]">
        Koʻrsatilmoqda: <span className="font-bold text-[var(--text)]">{teams.length}</span> ·
        jami {totals.all} jamoa, {totals.checked} tasi roʻyxatdan oʻtgan
      </p>

      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={
            "rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium " +
            (notice.ok
              ? "bg-[var(--success-soft)] text-[var(--success)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)]")
          }
        >
          {notice.ok ? notice.message : notice.error}
        </p>
      )}

      {editing && (
        <EditForm
          team={editing}
          onClose={() => setEditing(null)}
          onSaved={(state) => {
            setNotice(state);
            if (state.ok) setEditing(null);
          }}
        />
      )}

      {teams.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="size-8" />}
            title="Bu filtrga mos jamoa yoʻq"
            hint="Qidiruvni oʻzgartiring yoki «Hammasi» ni tanlang."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">Barcha jamoalar roʻyxati</caption>
              <thead>
                <tr className="bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-muted)]">
                  <th scope="col" className="w-20 py-2.5 pl-4 text-left">
                    Raqam
                  </th>
                  <th scope="col" className="text-left">
                    Jamoa
                  </th>
                  <th scope="col" className="w-40 text-left">
                    Maktab
                  </th>
                  <th scope="col" className="w-32 text-left">
                    Murabbiy
                  </th>
                  <th scope="col" className="w-16 text-center">
                    Guruh
                  </th>
                  <th scope="col" className="w-24 text-left">
                    Holat
                  </th>
                  <th scope="col" className="w-28 pr-4 text-right">
                    Amallar
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    expanded={expanded === team.id}
                    onToggle={() => setExpanded(expanded === team.id ? null : team.id)}
                    onEdit={() => setEditing(team)}
                    onNotice={setNotice}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function TeamRow({
  team,
  expanded,
  onToggle,
  onEdit,
  onNotice,
}: {
  team: AdminTeam;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onNotice: (state: TeamActionState) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"undo" | "delete" | null>(null);
  const category = isCategoryCode(team.categoryCode) ? team.categoryCode : undefined;

  const run = (fn: () => Promise<TeamActionState>) =>
    startTransition(async () => {
      onNotice(await fn());
      setConfirm(null);
    });

  return (
    <>
      <tr className="border-t border-[var(--border)] hover:bg-[var(--bg-subtle)]">
        <td className="py-2.5 pl-4">
          <TeamNumber value={team.number} category={category} size="sm" />
        </td>
        <td>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="text-left"
          >
            <span className="line-clamp-1 font-medium">{team.name}</span>
            <span className="block text-xs text-[var(--text-muted)]">
              {CATEGORIES[team.categoryCode as keyof typeof CATEGORIES]?.name}
              {team.memberCount > 0 && ` · ${team.memberCount} ishtirokchi`}
              {team.walkIn && " · joyida qoʻshilgan"}
            </span>
          </button>
        </td>
        <td className="text-[var(--text-muted)]">
          <span className="line-clamp-1">{team.school ?? "—"}</span>
        </td>
        <td className="text-[var(--text-muted)]">
          <span className="line-clamp-1">{team.coach ?? "—"}</span>
        </td>
        <td className="text-center">
          {team.groupName ? (
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-xs font-bold">
              {team.groupName}
            </span>
          ) : (
            <span className="text-[var(--text-subtle)]">—</span>
          )}
        </td>
        <td>
          {team.checkedInAt ? (
            <Badge tone="success">{formatTime(team.checkedInAt)}</Badge>
          ) : (
            <Badge tone="neutral">Kutilmoqda</Badge>
          )}
        </td>
        <td className="pr-4">
          <div className="flex items-center justify-end gap-0.5">
            {team.photoPath && (
              <span
                className="inline-flex size-8 items-center justify-center text-[var(--text-subtle)]"
                title="Robot surati bor"
              >
                <Camera className="size-4" aria-hidden="true" />
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Tahrirlash">
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
            {team.checkedInAt && (
              <Button
                variant="ghost"
                size="sm"
                loading={pending && confirm === "undo"}
                onClick={() =>
                  confirm === "undo" ? run(() => undoCheckIn(team.id)) : setConfirm("undo")
                }
                aria-label="Check-in bekor qilish"
                title={confirm === "undo" ? "Tasdiqlash uchun yana bosing" : "Check-in bekor"}
              >
                <UserMinus
                  className={"size-4 " + (confirm === "undo" ? "text-[var(--danger)]" : "")}
                  aria-hidden="true"
                />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              loading={pending && confirm === "delete"}
              onClick={() =>
                confirm === "delete" ? run(() => deleteTeam(team.id)) : setConfirm("delete")
              }
              aria-label="Oʻchirish"
              title={confirm === "delete" ? "Tasdiqlash uchun yana bosing" : "Oʻchirish"}
            >
              <Trash2
                className={"size-4 " + (confirm === "delete" ? "text-[var(--danger)]" : "")}
                aria-hidden="true"
              />
            </Button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-t border-[var(--border)] bg-[var(--bg-subtle)]">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Ishtirokchilar" value={team.members} />
                <Detail label="Viloyat" value={team.region} />
                <Detail label="Telefon" value={team.phone} />
                <Detail
                  label="Check-in"
                  value={
                    team.checkedInAt
                      ? `${formatTime(team.checkedInAt)}${team.checkedInBy ? ` · ${team.checkedInBy}` : ""}`
                      : "hali kelmagan"
                  }
                />
              </dl>

              {team.photoPath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/photo/${encodeURIComponent(team.photoPath)}`}
                  alt={`${team.name} roboti`}
                  className="h-32 w-44 rounded-[var(--radius-md)] object-cover"
                  loading="lazy"
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || "—"}</dd>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  // Debounce — har harfda URL almashtirmaymiz
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="relative min-w-[16rem] flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-subtle)]"
        aria-hidden="true"
      />
      <label htmlFor="teams-search" className="sr-only">
        Jamoalarni qidirish
      </label>
      <input
        id="teams-search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Jamoa, maktab, murabbiy…"
        className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] pl-9 pr-8 text-base outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
      />
      {text && (
        <button
          type="button"
          onClick={() => setText("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-subtle)] hover:text-[var(--text)]"
          aria-label="Qidiruvni tozalash"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
        (active
          ? "bg-[var(--text)] text-[var(--bg)]"
          : "bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]")
      }
    >
      {color && (
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      {label}
    </button>
  );
}

function ExportButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const csv = await exportTeamsCsv();
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `musobaqa-jamoalar-${new Date().toISOString().slice(0, 10)}.csv`;
          link.click();
          URL.revokeObjectURL(url);
        })
      }
    >
      <Download className="size-4" aria-hidden="true" />
      CSV
    </Button>
  );
}

/* ============================================================
   Tahrirlash
   ============================================================ */
function EditForm({
  team,
  onClose,
  onSaved,
}: {
  team: AdminTeam;
  onClose: () => void;
  onSaved: (state: TeamActionState) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold">
          {team.number ? `${team.number} · ` : ""}
          {team.name}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Yopish">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        action={(formData) =>
          startTransition(async () => {
            const state = await updateTeam(null, formData);
            if (!state.ok) setError(state.error);
            else setError(null);
            onSaved(state);
          })
        }
      >
        <input type="hidden" name="id" value={team.id} />

        <Field name="name" label="Jamoa nomi" defaultValue={team.name} required />
        <Field name="school" label="Maktab / markaz" defaultValue={team.school ?? ""} />
        <Field name="coach" label="Murabbiy" defaultValue={team.coach ?? ""} />
        <Field name="region" label="Viloyat" defaultValue={team.region ?? ""} />
        <Field name="phone" label="Telefon" defaultValue={team.phone ?? ""} type="tel" />
        <Field
          name="members"
          label="Ishtirokchilar (vergul bilan)"
          defaultValue={team.members ?? ""}
          className="sm:col-span-2"
        />

        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)] sm:col-span-2"
          >
            {error}
          </p>
        )}

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={pending}>
            Saqlash
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Bekor
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required,
  className,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={"flex flex-col gap-1.5 " + (className ?? "")}>
      <label htmlFor={`team-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`team-${name}`}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
      />
    </div>
  );
}
