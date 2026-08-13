"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Flag, Minus, Plus, RotateCcw, Play, Square, Trophy } from "lucide-react";
import { useLive } from "@/lib/realtime/use-live";
import { CATEGORIES, PENALTY_MS, type CategoryCode } from "@/lib/categories";
import { formatMs } from "@/lib/format";
import { roundName } from "@/lib/draw/engine";
import {
  revertMatch,
  revertRun,
  saveFootballResult,
  saveRaceResult,
  saveRun,
  saveSumoRound,
} from "@/server/actions/judge";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, LiveDot, TeamNumber } from "@/components/ui/primitives";
import { TimerDisplay, useTimer } from "./timer";
import { UndoBar } from "./undo-bar";
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
   * Tuzilma oʻzgarganda ekranni yangilaymiz.
   *
   * Bu «keyingi tur avtomatik boshlanadi» talabining hakam tomonidagi
   * yarmi: boshqa maydonda oxirgi natija yozilib yarim final ochilsa,
   * shu hakamning roʻyxatida u sahifani qayta yuklamasdan paydo boʻladi.
   *
   * Faqat TUZILMA oʻzgarishida yangilaymiz — har golda refresh qilsak
   * hakamning oʻz ekrani bejiz sakrab turadi.
   */
  const refreshing = useRef(false);
  const status = useLive(props.categoryCode, props.work.sinceId, (event) => {
    const structural =
      event.structure === true ||
      event.type === "draw.completed" ||
      event.type === "draw.cancelled";
    if (!structural || refreshing.current) return;

    refreshing.current = true;
    router.refresh();
    // Ketma-ket kelgan hodisalar bir nechta refresh chaqirmasin
    setTimeout(() => {
      refreshing.current = false;
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
   * «Bekor qilish» oynasi MatchPanel darajasida saqlanadi.
   *
   * Ilgari bu holat MatchCard ichida edi va ishlamasdi: natija
   * saqlangach kartochka «Navbatdagi» boʻlimidan «Yakunlangan» ga
   * koʻchardi, React uni boshqa joyda qaytadan yaratardi va lokal
   * holat yoʻqolardi — hakam bekor qilish tugmasini umuman koʻrmasdi.
   *
   * Shu sababdan yakunlangan oʻyin bekor qilish oynasi tugaguncha
   * oʻz joyida ham qoldiriladi: hakam qayerga qaragan boʻlsa oʻsha
   * yerda tugmani koʻradi.
   */
  const [undoLabels, setUndoLabels] = useState<Record<number, string>>({});

  const markSaved = useCallback((id: number, label: string) => {
    setUndoLabels((current) => ({ ...current, [id]: label }));
  }, []);

  const clearSaved = useCallback((id: number) => {
    setUndoLabels((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  // Yakunlangani bekor qilish oynasi tugaguncha oʻz joyida turadi,
  // lekin sanoqqa kirmaydi — «Navbatdagi · 5» har doim rost boʻlsin.
  const pending = matches.filter((m) => m.status !== "done" || undoLabels[m.id]);
  const done = matches.filter((m) => m.status === "done" && !undoLabels[m.id]);
  const pendingCount = matches.filter((m) => m.status !== "done").length;

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
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Navbatdagi oʻyinlar · {pendingCount}
        </h2>
        {pending.length === 0 ? (
          <Card>
            <EmptyState
              title="Hammasi yakunlandi"
              hint="Bu maydondagi barcha oʻyinlar natijasi yozilgan."
            />
          </Card>
        ) : (
          pending.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              categoryCode={categoryCode}
              totalRounds={work.totalRounds}
              open={openId === match.id}
              onOpen={() => setOpenId(openId === match.id ? null : match.id)}
              onPatch={patch}
              undoLabel={undoLabels[match.id] ?? null}
              onSaved={markSaved}
              onUndoDone={clearSaved}
            />
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
              undoLabel={undoLabels[match.id] ?? null}
              onSaved={markSaved}
              onUndoDone={clearSaved}
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
  undoLabel,
  onSaved,
  onUndoDone,
}: {
  match: JudgeMatch;
  categoryCode: CategoryCode;
  totalRounds: number;
  open: boolean;
  onOpen: () => void;
  onPatch: (id: number, changes: Partial<JudgeMatch>) => void;
  undoLabel: string | null;
  onSaved: (id: number, label: string) => void;
  onUndoDone: (id: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const category = CATEGORIES[categoryCode];
  const setUndoLabel = (label: string) => onSaved(match.id, label);

  const ready = match.teamA !== null && match.teamB !== null;
  const label =
    match.stage === "group"
      ? `${match.groupName ?? "?"} guruh`
      : roundName(match.round, totalRounds);

  const handleUndo = () => {
    startTransition(async () => {
      const result = await revertMatch(match.id);
      if (result.ok) {
        onPatch(match.id, {
          status: "pending",
          scoreA: 0,
          scoreB: 0,
          winnerId: null,
          roundsJson: null,
        });
      } else {
        setError(result.error);
      }
      onUndoDone(match.id);
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

      {/*
        «Bekor qilish» kartochka yopiq boʻlsa ham koʻrinadi.
        Ilgari u faqat ochiq kartochka ichida edi: hakam boshqa oʻyinni
        ochishi bilan yangi yozgan natijasini qaytarish imkoniyatini
        yoʻqotardi — bu 10 soniyalik kafolatni buzardi.
      */}
      {undoLabel && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
          <UndoBar
            label={undoLabel}
            onUndo={handleUndo}
            onExpire={() => onUndoDone(match.id)}
          />
        </div>
      )}

      {open && !undoLabel && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
          {!ready ? (
            <p className="text-center text-sm text-[var(--text-muted)]">
              Ikkala ishtirokchi hali aniqlanmagan — oldingi bosqich tugashini kuting.
            </p>
          ) : (
            <>
              {category.format === "group_playoff" && (
                <FootballControls
                  match={match}
                  pending={pending}
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
                        setUndoLabel(`Natija saqlandi: ${scoreA}:${scoreB}`);
                      } else setError(result.error);
                    })
                  }
                />
              )}

              {categoryCode === "S" && (
                <SumoControls
                  match={match}
                  pending={pending}
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
                        if (finished) setUndoLabel(`Uchrashuv yakunlandi: ${winsA}:${winsB}`);
                      } else setError(result.error);
                    })
                  }
                />
              )}

              {categoryCode === "RR" && (
                <RaceControls
                  match={match}
                  pending={pending}
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
                        setUndoLabel("Gʻolib saqlandi");
                      } else setError(result.error);
                    })
                  }
                />
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
  onSave,
}: {
  match: JudgeMatch;
  pending: boolean;
  onSave: (scoreA: number, scoreB: number) => void;
}) {
  const [a, setA] = useState(match.scoreA);
  const [b, setB] = useState(match.scoreB);
  const timer = useTimer();

  return (
    <div className="flex flex-col gap-4">
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

      <div className="grid grid-cols-2 gap-3">
        <Counter label={match.teamA?.number ?? "A"} value={a} onChange={setA} />
        <Counter label={match.teamB?.number ?? "B"} value={b} onChange={setB} />
      </div>

      <Button variant="primary" size="xl" block loading={pending} onClick={() => onSave(a, b)}>
        <Flag className="size-5" aria-hidden="true" />
        Yakunlash · {a}:{b}
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
}: {
  match: JudgeMatch;
  pending: boolean;
  onRound: (side: "a" | "b") => void;
}) {
  const rounds =
    ((match.roundsJson as { rounds?: { n: number; winner: "a" | "b" }[] } | null)?.rounds) ?? [];
  const winsA = match.scoreA;
  const winsB = match.scoreB;

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
        Raundni kim yutdi? <span className="tnum font-semibold">{winsA}:{winsB}</span> ·
        2-gʻalabada avtomatik yopiladi
      </p>

      {/* aria-label: tugmada faqat raqam turadi, skrinrider «S03» dan
          nima boʻlishini bilmaydi */}
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
    </div>
  );
}

/* ---------------- Robrace ---------------- */
function RaceControls({
  match,
  pending,
  onSave,
}: {
  match: JudgeMatch;
  pending: boolean;
  onSave: (side: "a" | "b", timeA: number | null, timeB: number | null) => void;
}) {
  const [timeA, setTimeA] = useState("");
  const [timeB, setTimeB] = useState("");

  const parse = (value: string) => {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm text-[var(--text-muted)]">
        Kim birinchi keldi?
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
  const [undoInfo, setUndoInfo] = useState<{ label: string; attemptNo: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const nextAttempt = team.attempts.length < 1 ? 1 : team.attempts.length < 2 ? 2 : null;
  const finalMs = timer.elapsed + penalties * PENALTY_MS;
  const best = team.attempts
    .filter((a) => a.status === "ok")
    .reduce<number | null>((min, a) => (min === null ? a.finalMs : Math.min(min, a.finalMs)), null);

  const save = (status: "ok" | "dnf") => {
    if (nextAttempt === null) return;
    startTransition(async () => {
      setError(null);
      const result = await saveRun(
        team.teamId,
        nextAttempt,
        status === "dnf" ? 0 : timer.elapsed,
        status === "dnf" ? 0 : penalties,
        status,
      );
      if (result.ok) {
        onPatch([
          ...team.attempts,
          {
            attemptNo: nextAttempt,
            rawMs: status === "dnf" ? 0 : timer.elapsed,
            penalties: status === "dnf" ? 0 : penalties,
            finalMs: result.data.finalMs,
            status,
          },
        ]);
        setUndoInfo({
          label:
            status === "dnf"
              ? `${nextAttempt}-urinish: DNF`
              : `${nextAttempt}-urinish: ${formatMs(result.data.finalMs)}`,
          attemptNo: nextAttempt,
        });
        timer.reset();
        setPenalties(0);
      } else {
        setError(result.error);
      }
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

      {/* Bekor qilish kartochka yopiq boʻlsa ham koʻrinadi — qarang:
          MatchCard dagi izoh */}
      {undoInfo && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
          <UndoBar
            label={undoInfo.label}
            onUndo={() =>
              startTransition(async () => {
                const result = await revertRun(team.teamId, undoInfo.attemptNo);
                if (result.ok) {
                  onPatch(team.attempts.filter((a) => a.attemptNo !== undoInfo.attemptNo));
                } else setError(result.error);
                setUndoInfo(null);
              })
            }
            onExpire={() => setUndoInfo(null)}
          />
        </div>
      )}

      {open && !undoInfo && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
          {nextAttempt === null ? (
            <p className="text-center text-sm text-[var(--text-muted)]">
              Ikkala urinish ham yozilgan.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {nextAttempt}-urinish
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
                <li key={attempt.attemptNo} className="flex justify-between">
                  <span className="text-[var(--text-muted)]">
                    {attempt.attemptNo}-urinish
                    {attempt.penalties > 0 && ` · ${attempt.penalties} jarima`}
                  </span>
                  <span className="tnum font-semibold">
                    {attempt.status === "dnf" ? "DNF" : formatMs(attempt.finalMs)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
