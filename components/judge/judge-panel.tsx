"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Flag,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Play,
  Square,
  Trash2,
  Trophy,
} from "lucide-react";
import { useLive } from "@/lib/realtime/use-live";
import { CATEGORIES, PENALTY_MS, type CategoryCode } from "@/lib/categories";
import { formatMs } from "@/lib/format";
import { roundName } from "@/lib/draw/engine";
import {
  revertRun,
  saveFootballResult,
  saveRaceResult,
  saveRun,
  saveSumoRound,
  undoSumoRound,
} from "@/server/actions/judge";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, LiveDot, TeamNumber } from "@/components/ui/primitives";
import { TimerDisplay, useTimer } from "./timer";
import type { JudgeMatch, JudgeTeamRun, JudgeWork } from "@/server/queries/judge";

type Props = {
  work: JudgeWork;
  categoryCode: CategoryCode;
  judgeName: string;
  fieldNo: number | null;
};

export function JudgePanel(props: Props) {
  const category = CATEGORIES[props.categoryCode];
  const router = useRouter();

  /**
   * Yoʻnalishda nimadir oʻzgarsa ekranni yangilaymiz.
   *
   * Ikki holat uchun kerak:
   *  • keyingi tur ochilishi — boshqa maydonda oxirgi natija yozilib
   *    yarim final tuzilsa, u shu hakamda sahifa yuklanmasdan chiqadi;
   *  • bitta maydonda ikki hakam (yoki bosh hakam) ishlayotgan boʻlsa —
   *    biri yozgan natijani ikkinchisi darhol koʻradi va ikki marta
   *    yozib qoʻymaydi.
   *
   * 800 ms oynada toʻplanadi: ketma-ket kelgan hodisalar bitta
   * yangilanishga aylanadi. Lokal holat (hisob hisoblagichi, taymer)
   * `router.refresh()` da yoʻqolmaydi — u faqat server maʼlumotini
   * almashtiradi.
   */
  const refreshing = useRef(false);
  const status = useLive(props.categoryCode, props.work.sinceId, () => {
    if (refreshing.current) return;

    refreshing.current = true;
    setTimeout(() => {
      refreshing.current = false;
      router.refresh();
    }, 800);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-muted)]">
          {category.format === "time_trial"
            ? "Urinishlar"
            : `Oʻyinlar · ${props.fieldNo ? `${props.fieldNo}-maydon` : "barcha maydonlar"}`}
        </p>
        <LiveDot status={status} />
      </div>

      {category.format === "time_trial" ? (
        <TimeTrialPanel {...props} />
      ) : (
        <MatchPanel {...props} />
      )}
    </div>
  );
}

/* ============================================================
   O'yin asosidagi yo'nalishlar: robofutbol, sumo, robrace
   ============================================================ */

function MatchPanel({ work, categoryCode, fieldNo }: Props) {
  const [matches, setMatches] = useState(work.matches);
  const [openId, setOpenId] = useState<number | null>(
    work.matches.find((m) => m.status !== "done")?.id ?? null,
  );

  /**
   * Server yangi maʼlumot yuborsa (router.refresh) uni qabul qilamiz.
   *
   * Bu shart boʻlmaganda yangi ochilgan tur ekranda paydo boʻlmasdi:
   * `useState` boshlangʻich qiymatni faqat bir marta oladi.
   * Lokal patch'lar allaqachon serverga yozilgan, shuning uchun
   * server nusxasi ustunroq — uni olamiz.
   */
  useEffect(() => {
    setMatches(work.matches);
  }, [work.matches]);

  const patch = useCallback((id: number, changes: Partial<JudgeMatch>) => {
    setMatches((list) => list.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }, []);

  /**
   * «Saqlandi» belgisi MatchPanel darajasida turadi.
   *
   * Natija saqlangach kartochka «Navbatdagi» boʻlimidan «Yakunlangan» ga
   * koʻchadi va React uni boshqa joyda qaytadan yaratadi — lokal holat
   * yoʻqolardi. Shuning uchun belgi shu yerda, oʻyin id'si boʻyicha.
   */
  const [savedIds, setSavedIds] = useState<Record<number, number>>({});

  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  const markSaved = useCallback((id: number) => {
    setSavedIds((current) => ({ ...current, [id]: Date.now() }));
    // Keyingi oʻyin oʻzi ochiladi — hakam qoʻshimcha bosishsiz davom etadi
    const next = matchesRef.current.find((m) => m.id !== id && m.status !== "done");
    setOpenId(next?.id ?? null);
  }, []);

  const pending = matches.filter((m) => m.status !== "done");
  const done = matches.filter((m) => m.status === "done");

  /** Shu maydonga biriktirilgan guruhlar — sarlavhada koʻrsatiladi */
  const myGroups = [...new Set(matches.map((m) => m.groupName).filter(Boolean))].sort() as string[];

  /**
   * Navbatdagilar guruh (yoki bosqich) boʻyicha ajratiladi.
   *
   * Bir maydonda bir necha guruh boʻlishi mumkin. Ajratmasak hakam
   * «bu qaysi guruhning oʻyini edi» deb har safar kartochkani oʻqiydi.
   */
  const pendingByLabel = (() => {
    const buckets = new Map<string, JudgeMatch[]>();
    for (const match of pending) {
      const label = match.groupName
        ? `${match.groupName} guruh`
        : roundName(match.round, work.totalRounds);
      buckets.set(label, [...(buckets.get(label) ?? []), match]);
    }
    return [...buckets.entries()];
  })();

  if (matches.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Trophy className="size-8" />}
          title="Sizning maydoningizda oʻyin yoʻq"
          hint={
            fieldNo
              ? `${fieldNo}-maydonga oʻyin biriktirilmagan. Jerebyovka oʻtkazilgach shu yerda paydo boʻladi.`
              : "Jerebyovka oʻtkazilgach oʻyinlar shu yerda paydo boʻladi."
          }
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        Hakam qaysi guruhlarni boshqarayotgani darhol koʻrinsin.
        Jerebyovkada har guruh bitta maydonga biriktiriladi, shuning
        uchun bu roʻyxat qisqa va oʻzgarmaydi.
      */}
      {myGroups.length > 0 && (
        <p className="rounded-[var(--radius-md)] bg-[var(--bg-subtle)] px-3 py-2 text-sm">
          <span className="font-semibold">
            {fieldNo ? `${fieldNo}-maydon` : "Barcha maydonlar"}
          </span>
          <span className="text-[var(--text-muted)]">
            {" · "}
            {myGroups.join(", ")} guruh
          </span>
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Navbatdagi oʻyinlar · {pending.length}
        </h2>
        {pending.length === 0 ? (
          <Card>
            <EmptyState
              title="Hammasi yakunlandi"
              hint="Bu maydondagi barcha oʻyinlar natijasi yozilgan."
            />
          </Card>
        ) : (
          pendingByLabel.map(([label, list]) => (
            <div key={label} className="flex flex-col gap-3">
              {pendingByLabel.length > 1 && (
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-subtle)]">
                  {label}
                </p>
              )}
              {list.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  categoryCode={categoryCode}
                  totalRounds={work.totalRounds}
                  open={openId === match.id}
                  onOpen={() => setOpenId(openId === match.id ? null : match.id)}
                  onPatch={patch}
                  justSaved={savedIds[match.id] ?? null}
                  onSaved={markSaved}
                />
              ))}
            </div>
          ))
        )}
      </section>

      {done.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Yakunlangan · {done.length}
          </h2>
          {done.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              categoryCode={categoryCode}
              totalRounds={work.totalRounds}
              open={openId === match.id}
              onOpen={() => setOpenId(openId === match.id ? null : match.id)}
              onPatch={patch}
              justSaved={savedIds[match.id] ?? null}
              onSaved={markSaved}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function MatchCard({
  match,
  categoryCode,
  totalRounds,
  open,
  onOpen,
  onPatch,
  justSaved,
  onSaved,
}: {
  match: JudgeMatch;
  categoryCode: CategoryCode;
  totalRounds: number;
  open: boolean;
  onOpen: () => void;
  onPatch: (id: number, changes: Partial<JudgeMatch>) => void;
  justSaved: number | null;
  onSaved: (id: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const category = CATEGORIES[categoryCode];

  /**
   * Natija darhol bazaga yoziladi, keyin tahrirlanadi.
   *
   * Ilgari saqlangandan keyin 10 soniyalik «bekor qilish» oynasi chiqardi:
   * shu vaqt oʻtib ketsa xatoni tuzatishning yoʻli qolmasdi va hakam
   * tashkilotchini chaqirardi. Endi cheklov yoʻq — yakunlangan oʻyinni
   * istalgan vaqtda ochib tuzatish mumkin, faqat keyingi bosqich
   * boshlangan boʻlsa server ruxsat bermaydi.
   */
  const [editing, setEditing] = useState(false);
  const isDone = match.status === "done";
  const showControls = !isDone || editing;

  const finish = () => {
    setEditing(false);
    onSaved(match.id);
  };

  const ready = match.teamA !== null && match.teamB !== null;
  const label =
    match.stage === "group"
      ? `${match.groupName ?? "?"} guruh`
      : roundName(match.round, totalRounds);

  const handleSumoUndo = () => {
    startTransition(async () => {
      setError(null);
      const result = await undoSumoRound(match.id);
      if (result.ok) {
        const { winsA, winsB, rounds } = result.data;
        onPatch(match.id, {
          scoreA: winsA,
          scoreB: winsB,
          status: rounds.length > 0 ? "live" : "pending",
          winnerId: null,
          roundsJson: rounds.length > 0 ? { rounds } : null,
        });
        setEditing(false);
      } else setError(result.error);
    });
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)]"
      >
        <span className="text-xs font-semibold text-[var(--text-muted)]">{label}</span>
        {match.fieldNo && (
          <Badge tone="neutral">{match.fieldNo}-maydon</Badge>
        )}
        <span className="ml-auto">
          {match.status === "done" ? (
            <Badge tone="success">
              <Check className="size-3" aria-hidden="true" />
              {match.scoreA}:{match.scoreB}
            </Badge>
          ) : match.status === "live" ? (
            <Badge tone="warning">Ketmoqda</Badge>
          ) : (
            <Badge tone="neutral">Kutilmoqda</Badge>
          )}
        </span>
      </button>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-[var(--border)] px-4 py-4">
        <TeamSide team={match.teamA} categoryCode={categoryCode} align="right" winner={match.winnerId === match.teamA?.id} />
        <span className="tnum text-2xl font-bold text-[var(--text-subtle)]">
          {match.status === "pending" ? "–" : `${match.scoreA}:${match.scoreB}`}
        </span>
        <TeamSide team={match.teamB} categoryCode={categoryCode} align="left" winner={match.winnerId === match.teamB?.id} />
      </div>

      {/* Saqlanganini tasdiqlash — kartochka yopiq boʻlsa ham koʻrinadi */}
      {justSaved !== null && isDone && !editing && <SavedFlash at={justSaved} />}

      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
          {!ready ? (
            <p className="text-center text-sm text-[var(--text-muted)]">
              Ikkala ishtirokchi hali aniqlanmagan — oldingi bosqich tugashini kuting.
            </p>
          ) : (
            <>
              {isDone && !editing && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    Natija saqlangan. Xato boʻlsa oʻzgartirishingiz mumkin.
                  </p>
                  <Button variant="secondary" size="lg" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Natijani oʻzgartirish
                  </Button>
                </div>
              )}

              {showControls && category.format === "group_playoff" && (
                <FootballControls
                  match={match}
                  pending={pending}
                  editing={editing}
                  onSave={(scoreA, scoreB) =>
                    startTransition(async () => {
                      setError(null);
                      const result = await saveFootballResult(match.id, scoreA, scoreB);
                      if (result.ok) {
                        onPatch(match.id, {
                          scoreA,
                          scoreB,
                          status: "done",
                          winnerId:
                            scoreA > scoreB
                              ? match.teamA!.id
                              : scoreB > scoreA
                                ? match.teamB!.id
                                : null,
                        });
                        finish();
                      } else setError(result.error);
                    })
                  }
                />
              )}

              {showControls && (categoryCode === "S" || categoryCode === "LS") && (
                <SumoControls
                  match={match}
                  pending={pending}
                  onUndoRound={handleSumoUndo}
                  onRound={(side) =>
                    startTransition(async () => {
                      setError(null);
                      const result = await saveSumoRound(match.id, side);
                      if (result.ok) {
                        const { winsA, winsB, finished } = result.data;
                        onPatch(match.id, {
                          scoreA: winsA,
                          scoreB: winsB,
                          status: finished ? "done" : "live",
                          winnerId: finished
                            ? winsA === 2
                              ? match.teamA!.id
                              : match.teamB!.id
                            : null,
                        });
                        if (finished) finish();
                      } else setError(result.error);
                    })
                  }
                />
              )}

              {showControls && categoryCode === "RC" && (
                <RaceControls
                  match={match}
                  pending={pending}
                  editing={editing}
                  onSave={(side, timeA, timeB) =>
                    startTransition(async () => {
                      setError(null);
                      const result = await saveRaceResult(match.id, side, timeA, timeB);
                      if (result.ok) {
                        onPatch(match.id, {
                          status: "done",
                          scoreA: side === "a" ? 1 : 0,
                          scoreB: side === "b" ? 1 : 0,
                          winnerId: side === "a" ? match.teamA!.id : match.teamB!.id,
                        });
                        finish();
                      } else setError(result.error);
                    })
                  }
                />
              )}

              {editing && (
                <Button
                  variant="ghost"
                  block
                  className="mt-3"
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                  }}
                >
                  Tahrirdan chiqish
                </Button>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
                >
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * «Saqlandi» chizigʻi — 6 soniya turadi.
 *
 * Bu shunchaki tasdiq: natija allaqachon bazada va tabloda. Hech qanday
 * tugma yoʻq, chunki tuzatish yoʻli — kartochkani ochib «oʻzgartirish».
 */
function SavedFlash({ at }: { at: number }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(id);
  }, [at]);

  if (!visible) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--success-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--success)]"
    >
      <Check className="size-4" aria-hidden="true" />
      Saqlandi — tabloda koʻrindi
    </p>
  );
}

function TeamSide({
  team,
  categoryCode,
  align,
  winner,
}: {
  team: JudgeMatch["teamA"];
  categoryCode: CategoryCode;
  align: "left" | "right";
  winner: boolean;
}) {
  return (
    <div
      className={
        "flex min-w-0 flex-col gap-1 " +
        (align === "right" ? "items-end text-right" : "items-start text-left")
      }
    >
      <TeamNumber value={team?.number ?? null} category={categoryCode} size="md" />
      <span
        className={
          "line-clamp-2 text-sm " + (winner ? "font-bold" : "text-[var(--text-muted)]")
        }
      >
        {team?.name ?? "kutilmoqda"}
      </span>
    </div>
  );
}

/* ---------------- Robofutbol ---------------- */
function FootballControls({
  match,
  pending,
  editing,
  onSave,
}: {
  match: JudgeMatch;
  pending: boolean;
  editing: boolean;
  onSave: (scoreA: number, scoreB: number) => void;
}) {
  const [a, setA] = useState(match.scoreA);
  const [b, setB] = useState(match.scoreB);
  const timer = useTimer();

  return (
    <div className="flex flex-col gap-4">
      {/* Tahrirda taymer keraksiz — oʻyin allaqachon oʻynalgan */}
      {!editing && (
        <>
          <TimerDisplay ms={timer.elapsed} running={timer.running} />
          <div className="flex justify-center gap-2">
            {timer.running ? (
              <Button variant="secondary" onClick={timer.stop}>
                <Square className="size-4" aria-hidden="true" />
                Toʻxtatish
              </Button>
            ) : (
              <Button variant="secondary" onClick={timer.start}>
                <Play className="size-4" aria-hidden="true" />
                {timer.elapsed > 0 ? "Davom" : "Boshlash"}
              </Button>
            )}
            <Button variant="ghost" onClick={timer.reset} disabled={timer.elapsed === 0}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Nol
            </Button>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Counter label={match.teamA?.number ?? "A"} value={a} onChange={setA} />
        <Counter label={match.teamB?.number ?? "B"} value={b} onChange={setB} />
      </div>

      {/* Durrang yoʻq — tugma bosilmaydi, sababi darhol koʻrinadi */}
      {a === b && (
        <p className="rounded-[var(--radius-md)] bg-[var(--warning-soft)] px-3 py-2 text-center text-sm font-medium text-[var(--warning)]">
          Hisob teng — gʻolib aniqlanishi shart
        </p>
      )}

      <Button
        variant="primary"
        size="xl"
        block
        loading={pending}
        disabled={a === b}
        onClick={() => onSave(a, b)}
      >
        <Flag className="size-5" aria-hidden="true" />
        {editing ? "Yangi hisobni saqlash" : "Yakunlash"} · {a}:{b}
      </Button>
    </div>
  );
}

function Counter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface)] p-3">
      <span className="text-xs font-semibold text-[var(--text-muted)]">{label}</span>
      <span className="tnum text-4xl font-bold">{value}</span>
      <div className="flex w-full gap-2">
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
          aria-label={`${label}: bitta kamaytirish`}
        >
          <Minus className="size-5" aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => onChange(Math.min(99, value + 1))}
          aria-label={`${label}: bitta qoʻshish`}
        >
          <Plus className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Sumo ---------------- */
function SumoControls({
  match,
  pending,
  onRound,
  onUndoRound,
}: {
  match: JudgeMatch;
  pending: boolean;
  onRound: (side: "a" | "b") => void;
  onUndoRound: () => void;
}) {
  const rounds =
    ((match.roundsJson as { rounds?: { n: number; winner: "a" | "b" }[] } | null)?.rounds) ?? [];
  const winsA = match.scoreA;
  const winsB = match.scoreB;
  const finished = match.status === "done";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center gap-2">
        {[1, 2, 3].map((n) => {
          const round = rounds.find((r) => r.n === n);
          return (
            <div
              key={n}
              className={
                "flex size-14 flex-col items-center justify-center rounded-[var(--radius-md)] border text-sm font-bold " +
                (round
                  ? "border-transparent bg-[var(--success)] text-white"
                  : "border-dashed border-[var(--border-strong)] text-[var(--text-subtle)]")
              }
            >
              <span className="text-[10px] font-medium opacity-80">{n}-raund</span>
              {round
                ? round.winner === "a"
                  ? (match.teamA?.number ?? "A")
                  : (match.teamB?.number ?? "B")
                : "—"}
            </div>
          );
        })}
      </div>

      <p className="text-center text-sm text-[var(--text-muted)]">
        {finished ? (
          <>
            Uchrashuv yakunlandi{" "}
            <span className="tnum font-semibold">{winsA}:{winsB}</span>
          </>
        ) : (
          <>
            Raundni kim yutdi? <span className="tnum font-semibold">{winsA}:{winsB}</span> ·
            2-gʻalabada avtomatik yopiladi
          </>
        )}
      </p>

      {/* aria-label: tugmada faqat raqam turadi, skrinrider «S03» dan
          nima boʻlishini bilmaydi */}
      {!finished && (
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            size="xl"
            loading={pending}
            onClick={() => onRound("a")}
            aria-label={`${match.teamA?.number ?? "A"} raundni yutdi`}
          >
            {match.teamA?.number ?? "A"}
          </Button>
          <Button
            variant="secondary"
            size="xl"
            loading={pending}
            onClick={() => onRound("b")}
            aria-label={`${match.teamB?.number ?? "B"} raundni yutdi`}
          >
            {match.teamB?.number ?? "B"}
          </Button>
        </div>
      )}

      {/*
        Sumoda tuzatish = oxirgi raundni qaytarish.
        Butun uchrashuvni tozalash oʻrniga bitta qadam orqaga: 3-raundda
        xato bosilgan boʻlsa 1- va 2-raund saqlanib qoladi.
      */}
      {rounds.length > 0 && (
        <Button variant="ghost" block loading={pending} onClick={onUndoRound}>
          <RotateCcw className="size-4" aria-hidden="true" />
          {rounds.length}-raundni bekor qilish
        </Button>
      )}
    </div>
  );
}

/* ---------------- Robrace ---------------- */
function RaceControls({
  match,
  pending,
  editing,
  onSave,
}: {
  match: JudgeMatch;
  pending: boolean;
  editing: boolean;
  onSave: (side: "a" | "b", timeA: number | null, timeB: number | null) => void;
}) {
  const saved = (match.roundsJson as { timeAMs?: number | null; timeBMs?: number | null } | null) ?? null;
  const asSeconds = (ms: number | null | undefined) =>
    typeof ms === "number" && ms > 0 ? String(ms / 1000) : "";

  const [timeA, setTimeA] = useState(() => asSeconds(saved?.timeAMs));
  const [timeB, setTimeB] = useState(() => asSeconds(saved?.timeBMs));

  const parse = (value: string) => {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm text-[var(--text-muted)]">
        {editing ? "Gʻolibni qaytadan belgilang" : "Kim birinchi keldi?"}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            size="xl"
            loading={pending}
            onClick={() => onSave("a", parse(timeA), parse(timeB))}
            aria-label={`${match.teamA?.number ?? "A"} birinchi keldi`}
          >
            {match.teamA?.number ?? "A"}
          </Button>
          <label className="sr-only" htmlFor={`ta-${match.id}`}>
            {match.teamA?.number} vaqti (soniya)
          </label>
          <input
            id={`ta-${match.id}`}
            inputMode="decimal"
            value={timeA}
            onChange={(e) => setTimeA(e.target.value)}
            placeholder="vaqt, s"
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-center text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            size="xl"
            loading={pending}
            onClick={() => onSave("b", parse(timeA), parse(timeB))}
            aria-label={`${match.teamB?.number ?? "B"} birinchi keldi`}
          >
            {match.teamB?.number ?? "B"}
          </Button>
          <label className="sr-only" htmlFor={`tb-${match.id}`}>
            {match.teamB?.number} vaqti (soniya)
          </label>
          <input
            id={`tb-${match.id}`}
            inputMode="decimal"
            value={timeB}
            onChange={(e) => setTimeB(e.target.value)}
            placeholder="vaqt, s"
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-center text-base"
          />
        </div>
      </div>
      <p className="text-center text-xs text-[var(--text-subtle)]">
        Vaqt ixtiyoriy — statistika uchun
      </p>
    </div>
  );
}

/* ============================================================
   Linefollower
   ============================================================ */

function TimeTrialPanel({ work, categoryCode }: Props) {
  const [teams, setTeams] = useState(work.teams);
  const [activeId, setActiveId] = useState<number | null>(null);

  // Server nusxasi kelsa qabul qilamiz — qarang: MatchPanel dagi izoh
  useEffect(() => {
    setTeams(work.teams);
  }, [work.teams]);

  const remaining = useMemo(
    () => teams.filter((t) => t.attempts.length < 2).length,
    [teams],
  );

  if (teams.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Check-in qilingan jamoa yoʻq"
          hint="Jamoalar roʻyxatdan oʻtgach shu yerda paydo boʻladi."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--text-muted)]">
        <span className="tnum font-semibold">{remaining}</span> ta jamoada urinish qoldi ·
        har chiqish <span className="font-semibold">+5 s</span>
      </p>

      {/* Semantik roʻyxat: skrinrider «7 tadan 3-jamoa» deb oʻqiydi */}
      <ul className="flex flex-col gap-3">
        {teams.map((team) => (
          <li key={team.teamId}>
            <RunCard
              team={team}
              categoryCode={categoryCode}
              open={activeId === team.teamId}
              onOpen={() => setActiveId(activeId === team.teamId ? null : team.teamId)}
              onPatch={(attempts) =>
                setTeams((list) =>
                  list.map((t) => (t.teamId === team.teamId ? { ...t, attempts } : t)),
                )
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunCard({
  team,
  categoryCode,
  open,
  onOpen,
  onPatch,
}: {
  team: JudgeTeamRun;
  categoryCode: CategoryCode;
  open: boolean;
  onOpen: () => void;
  onPatch: (attempts: JudgeTeamRun["attempts"]) => void;
}) {
  const timer = useTimer();
  const [penalties, setPenalties] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Qaysi urinish yozilyapti.
   *
   * `null` — navbatdagisi (1 yoki 2). Raqam — hakam yozilgan urinishni
   * tahrirlash uchun tanlagan. Natija darhol saqlanadi, keyin shu yerdan
   * tuzatiladi: bazada `runs` jadvali (team_id, attempt_no) boʻyicha
   * upsert qiladi, ya'ni qayta yozish tabiiy holat.
   */
  const [editAttempt, setEditAttempt] = useState<number | null>(null);

  const autoAttempt = team.attempts.length < 1 ? 1 : team.attempts.length < 2 ? 2 : null;
  const nextAttempt = editAttempt ?? autoAttempt;
  const finalMs = timer.elapsed + penalties * PENALTY_MS;
  const best = team.attempts
    .filter((a) => a.status === "ok")
    .reduce<number | null>((min, a) => (min === null ? a.finalMs : Math.min(min, a.finalMs)), null);

  const save = (status: "ok" | "dnf") => {
    if (nextAttempt === null) return;
    const attemptNo = nextAttempt;
    startTransition(async () => {
      setError(null);
      const result = await saveRun(
        team.teamId,
        attemptNo,
        status === "dnf" ? 0 : timer.elapsed,
        status === "dnf" ? 0 : penalties,
        status,
      );
      if (result.ok) {
        const row = {
          attemptNo,
          rawMs: status === "dnf" ? 0 : timer.elapsed,
          penalties: status === "dnf" ? 0 : penalties,
          finalMs: result.data.finalMs,
          status,
        };
        const rest = team.attempts.filter((a) => a.attemptNo !== attemptNo);
        onPatch([...rest, row].sort((x, y) => x.attemptNo - y.attemptNo));
        setSavedAt(Date.now());
        setEditAttempt(null);
        timer.reset();
        setPenalties(0);
      } else {
        setError(result.error);
      }
    });
  };

  const remove = (attemptNo: number) => {
    startTransition(async () => {
      setError(null);
      const result = await revertRun(team.teamId, attemptNo);
      if (result.ok) {
        onPatch(team.attempts.filter((a) => a.attemptNo !== attemptNo));
        if (editAttempt === attemptNo) setEditAttempt(null);
      } else setError(result.error);
    });
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)]"
      >
        <TeamNumber value={team.number} category={categoryCode} size="md" />
        <span className="line-clamp-1 flex-1 text-sm font-medium">{team.name}</span>
        <span className="tnum text-sm font-bold">
          {best !== null ? formatMs(best) : team.attempts.length ? "DNF" : "—"}
        </span>
        <Badge tone={team.attempts.length >= 2 ? "success" : "neutral"}>
          {team.attempts.length}/2
        </Badge>
      </button>

      {/* Saqlanganini tasdiqlash — kartochka yopiq boʻlsa ham koʻrinadi */}
      {savedAt !== null && <SavedFlash at={savedAt} />}

      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
          {nextAttempt === null ? (
            <p className="text-center text-sm text-[var(--text-muted)]">
              Ikkala urinish ham yozilgan. Tuzatish kerak boʻlsa quyidagi
              roʻyxatdan urinishni tanlang.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {nextAttempt}-urinish
                {editAttempt !== null && " · qayta yozilmoqda"}
              </p>

              <TimerDisplay ms={finalMs} running={timer.running} />
              {penalties > 0 && (
                <p className="tnum -mt-2 text-center text-sm text-[var(--warning)]">
                  {formatMs(timer.elapsed)} + {penalties} × 5 s jarima
                </p>
              )}

              <div className="flex justify-center gap-2">
                {timer.running ? (
                  <Button variant="danger" size="lg" onClick={timer.stop}>
                    <Square className="size-5" aria-hidden="true" />
                    Stop
                  </Button>
                ) : (
                  <Button variant="success" size="lg" onClick={timer.start}>
                    <Play className="size-5" aria-hidden="true" />
                    {timer.elapsed > 0 ? "Davom" : "Start"}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => setPenalties((n) => n + 1)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Jarima 5 s
                </Button>
                {penalties > 0 && (
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() => setPenalties((n) => Math.max(0, n - 1))}
                    aria-label="Jarimani kamaytirish"
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="primary"
                  size="xl"
                  loading={pending}
                  disabled={timer.elapsed === 0 || timer.running}
                  onClick={() => save("ok")}
                >
                  <Check className="size-5" aria-hidden="true" />
                  Saqlash
                </Button>
                <Button variant="danger" size="xl" loading={pending} onClick={() => save("dnf")}>
                  DNF
                </Button>
              </div>

              {timer.running && (
                <p className="text-center text-xs text-[var(--text-subtle)]">
                  Saqlash uchun avval taymerni toʻxtating
                </p>
              )}

              {editAttempt !== null && (
                <Button variant="ghost" block onClick={() => setEditAttempt(null)}>
                  Tahrirdan chiqish
                </Button>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
                >
                  {error}
                </p>
              )}
            </div>
          )}

          {team.attempts.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 border-t border-[var(--border)] pt-3 text-sm">
              {team.attempts.map((attempt) => (
                <li key={attempt.attemptNo} className="flex items-center gap-2">
                  <span className="text-[var(--text-muted)]">
                    {attempt.attemptNo}-urinish
                    {attempt.penalties > 0 && ` · ${attempt.penalties} jarima`}
                  </span>
                  <span className="tnum ml-auto font-semibold">
                    {attempt.status === "dnf" ? "DNF" : formatMs(attempt.finalMs)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setEditAttempt(attempt.attemptNo);
                      timer.reset();
                      setPenalties(0);
                    }}
                    aria-label={`${attempt.attemptNo}-urinishni qayta yozish`}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={pending}
                    onClick={() => remove(attempt.attemptNo)}
                    aria-label={`${attempt.attemptNo}-urinishni oʻchirish`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
