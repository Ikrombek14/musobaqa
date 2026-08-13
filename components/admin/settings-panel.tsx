"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Clock, LayoutGrid, Save } from "lucide-react";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import {
  saveGroupFields,
  updateCategorySettings,
  type SettingsState,
} from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import type { GroupFieldRow } from "@/server/queries/admin";

export type CategorySettings = {
  code: CategoryCode;
  fieldCount: number;
  groupSize: number;
  matchMinutes: number;
  drawLocked: boolean;
  checkedIn: number;
  matchesTotal: number;
  matchesDone: number;
  groups: GroupFieldRow[];
  fieldLoad: { fieldNo: number; pending: number; done: number }[];
};

export function SettingsPanel({ categories }: { categories: CategorySettings[] }) {
  return (
    <div className="flex flex-col gap-5">
      {categories.map((category) => (
        <CategorySettingsCard key={category.code} settings={category} />
      ))}
    </div>
  );
}

function CategorySettingsCard({ settings }: { settings: CategorySettings }) {
  const category = CATEGORIES[settings.code];
  const [state, formAction, pending] = useActionState<SettingsState | null, FormData>(
    updateCategorySettings,
    null,
  );

  // Slayderlar — kalkulyator darhol hisoblasin
  const [fieldCount, setFieldCount] = useState(settings.fieldCount);
  const [groupSize, setGroupSize] = useState(settings.groupSize);
  const [matchMinutes, setMatchMinutes] = useState(settings.matchMinutes);

  const estimate = useMemo(
    () =>
      estimateSchedule({
        format: category.format,
        teams: settings.checkedIn,
        groupSize,
        fieldCount,
        matchMinutes,
        actualMatches: settings.matchesTotal,
      }),
    [category.format, settings.checkedIn, settings.matchesTotal, groupSize, fieldCount, matchMinutes],
  );

  return (
    <Card role="region" aria-label={category.name} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-5 py-3">
        <span
          className="h-7 w-1.5 rounded-full"
          style={{ backgroundColor: category.colorVar }}
          aria-hidden="true"
        />
        <h2 className="font-bold">{category.name}</h2>
        <span className="tnum text-sm text-[var(--text-muted)]">
          {settings.checkedIn} jamoa
        </span>
        {settings.drawLocked && <Badge tone="success">Jerebyovka boʻlgan</Badge>}
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_20rem]">
        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="categoryCode" value={settings.code} />

          <Slider
            id={`fields-${settings.code}`}
            name="fieldCount"
            label="Maydonlar soni"
            hint="Nechta maydonda parallel oʻyin boradi"
            min={1}
            max={12}
            value={fieldCount}
            onChange={setFieldCount}
          />

          {category.format === "group_playoff" && (
            <Slider
              id={`gsize-${settings.code}`}
              name="groupSize"
              label="Guruh oʻlchami"
              hint={
                settings.drawLocked
                  ? "Jerebyovka oʻtkazilgan — oʻzgartirib boʻlmaydi"
                  : "Bitta guruhda nechta jamoa"
              }
              min={2}
              max={8}
              value={groupSize}
              onChange={setGroupSize}
              disabled={settings.drawLocked}
            />
          )}
          {category.format !== "group_playoff" && (
            <input type="hidden" name="groupSize" value={groupSize} />
          )}

          <Slider
            id={`mins-${settings.code}`}
            name="matchMinutes"
            label="Oʻyin davomiyligi"
            hint="Daqiqa, jadval hisobi uchun"
            min={1}
            max={30}
            value={matchMinutes}
            onChange={setMatchMinutes}
            unit="daq"
          />

          {state && (
            <p
              role={state.ok ? "status" : "alert"}
              className={
                "rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium " +
                (state.ok
                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                  : "bg-[var(--danger-soft)] text-[var(--danger)]")
              }
            >
              {state.ok ? state.message : state.error}
            </p>
          )}

          <div>
            <Button type="submit" variant="primary" loading={pending}>
              <Save className="size-4" aria-hidden="true" />
              Saqlash
            </Button>
          </div>
        </form>

        {/* Kalkulyator — raqam kontekst bilan */}
        <aside className="flex flex-col gap-3 rounded-[var(--radius-md)] bg-[var(--bg-subtle)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Clock className="size-4" aria-hidden="true" />
            Vaqt hisobi
          </h3>
          <p className="tnum text-3xl font-bold tracking-tight">{estimate.duration}</p>
          <p className="text-sm text-[var(--text-muted)]">{estimate.explanation}</p>

          {settings.fieldLoad.length > 0 && (
            <div className="mt-1 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Maydonlardagi navbat
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {settings.fieldLoad.map((row) => (
                  <li key={row.fieldNo} className="tnum flex justify-between">
                    <span className="text-[var(--text-muted)]">{row.fieldNo}-maydon</span>
                    <span className="font-semibold">
                      {row.pending} kutmoqda · {row.done} boʻldi
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {settings.groups.length > 0 && (
        <GroupFields
          groups={settings.groups}
          fieldCount={settings.fieldCount}
          categoryName={category.name}
        />
      )}
    </Card>
  );
}

/* ============================================================
   Guruh → maydon
   ============================================================ */
function GroupFields({
  groups,
  fieldCount,
  categoryName,
}: {
  groups: GroupFieldRow[];
  fieldCount: number;
  categoryName: string;
}) {
  const [state, formAction, pending] = useActionState<SettingsState | null, FormData>(
    saveGroupFields,
    null,
  );

  return (
    <div className="border-t border-[var(--border)] p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <LayoutGrid className="size-4" aria-hidden="true" />
        Qaysi guruh qaysi maydonda
      </h3>
      <p className="mt-1 max-w-[70ch] text-sm text-[var(--text-muted)]">
        «Avtomatik» qoldirilsa tizim yukni oʻzi teng taqsimlaydi. Maydon
        tanlansa, shu guruhning barcha <strong>boshlanmagan</strong> oʻyinlari
        oʻsha maydonga koʻchadi — ketayotgan oʻyin tegilmaydi.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-sm font-bold">
                {group.name}
              </span>
              <span className="tnum min-w-0 flex-1 text-xs text-[var(--text-muted)]">
                {group.teamCount} jamoa
                <br />
                {group.matchesDone}/{group.matchesTotal} oʻyin
              </span>
              <label className="sr-only" htmlFor={`group-${group.id}`}>
                {categoryName} {group.name} guruh maydoni
              </label>
              <select
                id={`group-${group.id}`}
                name={`group-${group.id}`}
                defaultValue={group.fieldNo === null ? "auto" : String(group.fieldNo)}
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
              >
                <option value="auto">Avtomatik</option>
                {Array.from({ length: fieldCount }, (_, i) => i + 1).map((field) => (
                  <option key={field} value={field}>
                    {field}-maydon
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {state && (
          <p
            role={state.ok ? "status" : "alert"}
            className={
              "rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium " +
              (state.ok
                ? "bg-[var(--success-soft)] text-[var(--success)]"
                : "bg-[var(--danger-soft)] text-[var(--danger)]")
            }
          >
            {state.ok ? state.message : state.error}
          </p>
        )}

        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            <Save className="size-4" aria-hidden="true" />
            Guruh maydonlarini saqlash
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================
   Slayder
   ============================================================ */
function Slider({
  id,
  name,
  label,
  hint,
  min,
  max,
  value,
  onChange,
  unit,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="tnum text-lg font-bold">
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--bg-subtle)] accent-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p className="text-xs text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

/* ============================================================
   Jadval kalkulyatori
   ============================================================ */
function estimateSchedule({
  format,
  teams,
  groupSize,
  fieldCount,
  matchMinutes,
  actualMatches,
}: {
  format: string;
  teams: number;
  groupSize: number;
  fieldCount: number;
  matchMinutes: number;
  actualMatches: number;
}): { duration: string; explanation: string } {
  if (teams === 0) {
    return {
      duration: "—",
      explanation: "Check-in qilingan jamoa yoʻq — hisoblash uchun maʼlumot yetarli emas.",
    };
  }

  let matches: number;
  let breakdown: string;

  if (actualMatches > 0) {
    // Jerebyovka oʻtkazilgan — taxmin emas, aniq son
    matches = actualMatches;
    breakdown = `${matches} ta tuzilgan oʻyin`;
  } else if (format === "group_playoff") {
    const groups = Math.max(1, Math.ceil(teams / groupSize));
    // Jamoalar guruhlarga teng taqsimlanadi
    const base = Math.floor(teams / groups);
    const extra = teams % groups;
    let groupMatches = 0;
    for (let i = 0; i < groups; i++) {
      const size = base + (i < extra ? 1 : 0);
      groupMatches += (size * (size - 1)) / 2;
    }
    const playoffTeams = 2 ** Math.ceil(Math.log2(Math.max(2, groups * 2)));
    const playoffMatches = playoffTeams - 1;
    matches = groupMatches + playoffMatches;
    breakdown = `${groups} guruh → ${groupMatches} guruh oʻyini + ${playoffMatches} pleyoff`;
  } else if (format === "time_trial") {
    matches = teams * 2;
    breakdown = `${teams} jamoa × 2 urinish`;
  } else {
    matches = Math.max(1, teams - 1);
    breakdown = `${teams} jamoa → ${matches} uchrashuv`;
  }

  const rounds = Math.ceil(matches / Math.max(1, fieldCount));
  const minutes = rounds * matchMinutes;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  const duration =
    hours > 0
      ? `${hours} soat${rest > 0 ? ` ${rest} daqiqa` : ""}`
      : `${minutes} daqiqa`;

  return {
    duration,
    explanation: `${breakdown} · ${fieldCount} maydon · ${matchMinutes} daq. Maydonlar toʻliq band deb hisoblangan; tanaffus va kechikish hisobga olinmagan.`,
  };
}
