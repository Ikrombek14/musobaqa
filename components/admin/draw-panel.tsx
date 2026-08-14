"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Shuffle, Trophy, Undo2 } from "lucide-react";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import { cancelDraw, resetCategory, runDraw, type DrawState } from "@/server/actions/draw";
import { generatePlayoff } from "@/server/actions/playoff";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";

type Row = {
  code: string;
  drawLocked: boolean;
  checkedIn: number;
  total: number;
  groupSize: number;
  matchesTotal: number;
  matchesPlayed: number;
  /** Faqat robofutbol uchun: guruh bosqichi holati */
  groupStage: { total: number; done: number; complete: boolean } | null;
  playoffExists: boolean;
};

export function DrawPanel({ rows }: { rows: Row[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((row) => (
        <DrawCard key={row.code} row={row} />
      ))}
    </div>
  );
}

function DrawCard({ row }: { row: Row }) {
  const code = row.code as CategoryCode;
  const category = CATEGORIES[code];
  const [state, setState] = useState<DrawState | null>(null);
  const [confirming, setConfirming] = useState<"run" | "cancel" | null>(null);
  const [pending, startTransition] = useTransition();

  if (!category) return null;

  const canDraw = row.checkedIn >= 2;
  const preview =
    category.format === "group_playoff" && row.checkedIn >= 2
      ? previewGroups(row.checkedIn, row.groupSize)
      : null;

  const handleRun = () => {
    startTransition(async () => {
      setState(await runDraw(code));
      setConfirming(null);
    });
  };

  const handleCancel = () => {
    startTransition(async () => {
      setState(await cancelDraw(code));
      setConfirming(null);
    });
  };

  const handlePlayoff = () => {
    startTransition(async () => {
      const result = await generatePlayoff(code);
      setState(
        result.ok
          ? { ok: true, seed: "", warnings: [], summary: result.summary }
          : { ok: false, error: result.error },
      );
    });
  };

  return (
    // role+aria-label: skrinriderga qaysi yoʻnalish kartochkasi ekanini
    // aytadi va sinovga barqaror tayanch nuqta beradi
    <Card role="region" aria-label={category.name} className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="h-9 w-1.5 rounded-full"
            style={{ backgroundColor: category.colorVar }}
            aria-hidden="true"
          />
          <div>
            <h2 className="font-bold">{category.name}</h2>
            <p className="tnum text-sm text-[var(--text-muted)]">
              {row.checkedIn} ta check-in qilingan jamoa
              {category.format === "group_playoff" && ` · ${row.groupSize} talik guruh`}
            </p>
            {/* Jerebyovkadan OLDIN nima chiqishini koʻrsatamiz —
                guruh oʻlchamini keyin oʻzgartirib boʻlmaydi */}
            {category.format === "group_playoff" && !row.drawLocked && preview && (
              <p className="tnum mt-0.5 text-sm font-medium">
                {preview.groups} guruh · {preview.matches} ta guruh oʻyini
                <span className="font-normal text-[var(--text-muted)]">
                  {" "}
                  ({preview.shape})
                </span>
              </p>
            )}
          </div>
        </div>
        {row.drawLocked ? (
          <Badge tone="success">Oʻtkazilgan</Badge>
        ) : (
          <Badge tone="neutral">Kutilmoqda</Badge>
        )}
      </div>

      {/* Natija/xato paneli — joyi doim band, layout sakramaydi */}
      <div className="mt-4 min-h-[4.5rem]">
        {state?.ok === true && state.summary && (
          <div className="rounded-[var(--radius-md)] bg-[var(--success-soft)] p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {state.summary}
            </p>
            {state.seed && (
              <p className="mt-1.5 font-mono text-[11px] break-all text-[var(--text-muted)]">
                seed: {state.seed}
              </p>
            )}
            {state.warnings.map((warning) => (
              <p
                key={warning}
                className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--warning)]"
              >
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
          </div>
        )}

        {state?.ok === false && (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger)]"
          >
            {state.error}
          </p>
        )}

        {!state && !row.drawLocked && !canDraw && (
          <p className="rounded-[var(--radius-md)] bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning)]">
            Jerebyovka uchun kamida 2 ta jamoa check-in qilingan boʻlishi kerak.
          </p>
        )}

        {/*
          Jerebyovkaga FAQAT check-in qilinganlar kiradi. Kelmagan bola
          bor boʻlsa u jadvaldan tashqarida qoladi va buni musobaqa
          oʻrtasida sezish qiyin — shuning uchun ogohlantirish.
        */}
        {!state && !row.drawLocked && canDraw && row.checkedIn < row.total && (
          <p className="rounded-[var(--radius-md)] bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning)]">
            <strong className="tnum">{row.total - row.checkedIn}</strong> ta jamoa hali
            roʻyxatdan oʻtmagan. Jerebyovkaga faqat kelganlar kiradi — check-in
            tugagach oʻtkazish maʼqul.
          </p>
        )}

        {!state && row.drawLocked && (
          <p className="tnum rounded-[var(--radius-md)] bg-[var(--bg-subtle)] p-3 text-sm text-[var(--text-muted)]">
            {row.matchesTotal} ta oʻyin tuzilgan · {row.matchesPlayed} tasi oʻynalgan
            {row.groupStage && !row.playoffExists && (
              <span className="mt-1 block">
                Guruh bosqichi: {row.groupStage.done}/{row.groupStage.total}
                {row.groupStage.complete
                  ? " — pleyoff tuzishga tayyor"
                  : " — tugagach pleyoff tuziladi"}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!row.drawLocked ? (
          confirming === "run" ? (
            <>
              <Button variant="primary" onClick={handleRun} loading={pending}>
                Ha, oʻtkazilsin
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
                Bekor
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => setConfirming("run")}
              disabled={!canDraw || pending}
            >
              <Shuffle className="size-4" aria-hidden="true" />
              Jerebyovka oʻtkazish
            </Button>
          )
        ) : confirming === "cancel" ? (
          <>
            <Button variant="danger" onClick={handleCancel} loading={pending}>
              Ha, bekor qilinsin
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
              Yoʻq
            </Button>
          </>
        ) : (
          <>
            {row.groupStage && !row.playoffExists && (
              <Button
                variant="primary"
                onClick={handlePlayoff}
                loading={pending}
                disabled={!row.groupStage.complete}
                title={
                  row.groupStage.complete
                    ? undefined
                    : "Guruh bosqichi tugamagan — top-2 hali aniq emas"
                }
              >
                <Trophy className="size-4" aria-hidden="true" />
                Pleyoff tuzish
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setConfirming("cancel")}
              disabled={pending || row.matchesPlayed > 0}
              title={
                row.matchesPlayed > 0
                  ? "Natija yozilgan — pastdagi «Noldan boshlash» dan foydalaning"
                  : undefined
              }
            >
              <Undo2 className="size-4" aria-hidden="true" />
              Bekor qilish
            </Button>
          </>
        )}
      </div>

      {/*
        Oxirgi chora: natija yozilgan boʻlsa ham hammasini oʻchirib
        qaytadan boshlash. Bir bosishlik tugma emas — yoʻnalish nomi
        yozib tasdiqlanadi, chunki qaytarib boʻlmaydi.
      */}
      {row.drawLocked && row.matchesPlayed > 0 && (
        <ResetZone code={code} name={category.name} matchesPlayed={row.matchesPlayed} />
      )}
    </Card>
  );
}

/**
 * Jerebyovkadan oldin nima chiqishini hisoblaydi.
 *
 * `drawGroups` bilan bir xil qoida: guruhlar soni `ceil(n / oʻlcham)`,
 * jamoalar esa teng taqsimlanadi. Guruh oʻlchamini jerebyovkadan keyin
 * oʻzgartirib boʻlmaydi, shuning uchun tashkilotchi natijani OLDIN
 * koʻrishi kerak: 4 talik guruhda 6 tadan oʻyin, 3 talikda 3 tadan.
 */
function previewGroups(
  teams: number,
  size: number,
): { groups: number; matches: number; shape: string } {
  const groups = Math.max(1, Math.ceil(teams / size));
  const base = Math.floor(teams / groups);
  const bigger = teams % groups; // shuncha guruhda bittadan koʻp

  const pairs = (n: number) => (n * (n - 1)) / 2;
  const matches = bigger * pairs(base + 1) + (groups - bigger) * pairs(base);

  const parts: string[] = [];
  if (bigger > 0) parts.push(`${bigger} ta ${base + 1} talik`);
  if (groups - bigger > 0) parts.push(`${groups - bigger} ta ${base} talik`);

  return { groups, matches, shape: parts.join(", ") };
}

/* ============================================================
   Noldan boshlash — xavfli zona
   ============================================================ */

/**
 * Yoʻnalishni natijalari bilan birga tozalash.
 *
 * «Bekor qilish» natija yozilgan boʻlsa ishlamaydi va bu ataylab:
 * musobaqa ketayotganda tasodifan bosilgan tugma butun kunni
 * yoʻqotardi. Lekin tashkilotchida oxirgi chora boʻlishi kerak —
 * jerebyovka notoʻgʻri sozlama bilan oʻtkazilgan boʻlishi mumkin.
 *
 * Shuning uchun tasdiq YOZIB kiritiladi. Bu ataylab sekin: bunday
 * amal shoshib bajarilmasligi kerak.
 */
function ResetZone({
  code,
  name,
  matchesPlayed,
}: {
  code: CategoryCode;
  name: string;
  matchesPlayed: number;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<DrawState | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = text.trim().toLowerCase() === name.toLowerCase();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 self-start text-xs font-medium text-[var(--text-subtle)] underline-offset-2 hover:text-[var(--danger)] hover:underline"
      >
        Noldan boshlash
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--danger)] p-3">
      <p className="text-sm font-semibold text-[var(--danger)]">
        {name}ni noldan boshlash
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        <strong className="tnum">{matchesPlayed}</strong> ta yozilgan natija, barcha
        oʻyin va guruhlar oʻchadi. Jamoalar, raqamlar va hakamlar joyida qoladi.
        Qaytarib boʻlmaydi.
      </p>

      <label htmlFor={`reset-${code}`} className="mt-2 block text-xs font-medium">
        Tasdiq uchun «{name}» deb yozing
      </label>
      <input
        id={`reset-${code}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm outline-none focus:border-[var(--danger)]"
      />

      {state?.ok === false && (
        <p role="alert" className="mt-2 text-xs font-medium text-[var(--danger)]">
          {state.error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          size="sm"
          disabled={!matches}
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await resetCategory(code, text);
              setState(result);
              if (result.ok) {
                setOpen(false);
                setText("");
              }
            })
          }
        >
          Hammasini oʻchirish
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setText("");
            setState(null);
          }}
          disabled={pending}
        >
          Bekor
        </Button>
      </div>
    </div>
  );
}
