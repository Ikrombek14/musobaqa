"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Check, RotateCcw, Search, UserPlus, Users, X } from "lucide-react";
import { CATEGORIES, CATEGORY_LIST, isCategoryCode } from "@/lib/categories";
import {
  addPartner,
  checkInTeam,
  createWalkInTeam,
  saveRobotPhoto,
  searchTeamsAction,
  updateTeamAtCheckIn,
  type CheckInResult,
} from "@/server/actions/checkin";
import { assignTag, nextFreeTag } from "@/server/actions/tags";
import type { SearchHit } from "@/server/queries/competition";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, TeamNumber } from "@/components/ui/primitives";

type Step = "search" | "confirm" | "tag" | "photo" | "done";

/**
 * Check-in — uch qadam, ~25 soniya.
 *
 * Qidiruv 200 ms debounce bilan ketadi va kech qaytgan javob yangisini
 * bosib ketmasligi uchun so'rov raqami bilan tekshiriladi (race guard) —
 * tez yozganda "eski natija ko'rinib qolish" muammosi shu yerda yopilgan.
 */
export function CheckInScreen() {
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  /** Yorliq qadami uchun yoʻnalish — roʻyxatdan ham, yangi jamoadan ham keladi */
  const [tagCategory, setTagCategory] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);
  /** Tasdiq ekranida joyida tahrirlanadigan maydonlar */
  const [draftCategory, setDraftCategory] = useState("");
  const [draftName, setDraftName] = useState("");
  const [partner, setPartner] = useState<SearchHit | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const found = await searchTeamsAction(text);
      if (id !== requestId.current) return; // eskirgan javob
      setHits(found);
      setSearching(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const reset = () => {
    setStep("search");
    setQuery("");
    setHits([]);
    setSelected(null);
    setTagCategory(null);
    setResult(null);
    setDraftCategory("");
    setDraftName("");
    setPartner(null);
    setWalkInOpen(false);
    inputRef.current?.focus();
  };

  const openTeam = (hit: SearchHit) => {
    setSelected(hit);
    setDraftCategory(hit.categoryCode);
    setDraftName(hit.name);
    setPartner(null);
    setResult(null);
    setStep("confirm");
  };

  /**
   * «Keldi» — bitta bosishda hammasi.
   *
   * Tuzatilgan yoʻnalish/ism, qoʻshilgan sherik va check-in shu yerda
   * ketma-ket bajariladi. Roʻyxatdan oʻtkazish stolida navbat turadi,
   * shuning uchun har biri uchun alohida tugma qoʻyilmagan.
   */
  const confirmArrival = (team: SearchHit) => {
    startTransition(async () => {
      setResult(null);
      let categoryCode = team.categoryCode;

      const edited =
        draftCategory !== team.categoryCode || draftName.trim() !== team.name;

      if (edited) {
        const form = new FormData();
        form.set("teamId", String(team.id));
        form.set("categoryCode", draftCategory);
        form.set("name", draftName.trim());
        const res = await updateTeamAtCheckIn(null, form);
        if (!res.ok) {
          setResult(res);
          return;
        }
        categoryCode = draftCategory;
      }

      if (partner) {
        const res = await addPartner(team.id, partner.id);
        if (!res.ok) {
          setResult(res);
          return;
        }
      }

      const res = await checkInTeam(team.id);
      setResult(res);
      if (res.ok) {
        setTagCategory(categoryCode);
        setStep("tag");
      }
    });
  };

  /* ---------------- 4-qadam: raqam koʻrsatiladi ---------------- */
  if (step === "done" && result?.ok) {
    return <NumberReveal result={result} onNext={reset} />;
  }

  /* ---------------- 3-qadam: surat ---------------- */
  if (step === "photo" && result?.ok) {
    return (
      <PhotoStep
        teamId={result.teamId}
        teamName={result.name}
        number={result.number}
        onDone={() => setStep("done")}
        onSkip={() => setStep("done")}
      />
    );
  }

  /* ---------------- 2.5-qadam: yorliqni biriktirish ---------------- */
  if (step === "tag" && result?.ok && tagCategory) {
    return (
      <TagStep
        teamId={result.teamId}
        teamName={result.name}
        categoryCode={tagCategory}
        onDone={(code) => {
          setResult({ ...result, number: code });
          setStep("photo");
        }}
        onBack={() => setStep(selected ? "confirm" : "search")}
      />
    );
  }

  /* ---------------- 2-qadam: tasdiq ---------------- */
  if (step === "confirm" && selected) {
    const moved = draftCategory !== selected.categoryCode;
    const maxMembers = isCategoryCode(draftCategory)
      ? CATEGORIES[draftCategory].maxMembers
      : 1;
    const memberList = (selected.members ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    return (
      <div className="mx-auto w-full max-w-xl">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            {/*
              Yoʻnalish va ism shu yerning oʻzida tahrirlanadi.
              Stolda navbat turadi: qoʻshimcha tugma yoki alohida
              ekran har bir bolaga bir necha soniya qoʻshadi.
              Oʻzgarish «Keldi» bosilganda saqlanadi — baribir
              bosiladigan tugma, ortiqcha click yoʻq.
            */}
            <div className="min-w-0 flex-1">
              <label htmlFor="confirm-category" className="sr-only">
                Yoʻnalish
              </label>
              <select
                id="confirm-category"
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                className="-ml-1 h-7 rounded border-0 bg-transparent px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] outline-none hover:bg-[var(--bg-subtle)] focus:bg-[var(--bg-subtle)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              >
                {CATEGORY_LIST.map((cat) => (
                  <option key={cat.code} value={cat.code}>
                    {cat.name}
                  </option>
                ))}
              </select>

              <label htmlFor="confirm-name" className="sr-only">
                Ism / jamoa nomi
              </label>
              <input
                id="confirm-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                autoComplete="off"
                className="-ml-1 mt-0.5 w-full rounded border-0 bg-transparent px-1 text-xl font-bold outline-none hover:bg-[var(--bg-subtle)] focus:bg-[var(--bg-subtle)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={reset} aria-label="Yopish">
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Maktab" value={selected.school} />
            <Field label="Viloyat" value={selected.region} />
            <Field label="Murabbiy" value={selected.coach} />
            <Field label="Ishtirokchilar" value={memberList.join(", ") || null} />
          </dl>

          {/*
            Robofutbolda bitta raqam ikki bolaga beriladi (F1 qogʻozi
            ikki nusxada). Sherik shu yerda qoʻshiladi — «Keldi» bilan
            bir vaqtda saqlanadi, alohida qadam yoʻq.
          */}
          {maxMembers > 1 && (
            <div className="mt-4">
              {memberList.length >= maxMembers ? (
                <p className="rounded-[var(--radius-md)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-muted)]">
                  Bitta raqamda {maxMembers} ta ishtirokchi — toʻldi.
                </p>
              ) : partner ? (
                <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--success-soft)] px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--success)]">
                    Sherigi: {partner.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPartner(null)}
                    aria-label="Sherikni olib tashlash"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <PartnerPicker
                  categoryCode={draftCategory}
                  excludeId={selected.id}
                  onPick={setPartner}
                />
              )}
            </div>
          )}

          {moved && selected.number && (
            <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
              <span className="tnum font-bold">{selected.number}</span> yorligʻi boʻshaydi —
              bolaga yangi yoʻnalishning qogʻozini bering.
            </p>
          )}

          {!moved && selected.checkedInAt && (
            <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
              Bu jamoa allaqachon roʻyxatdan oʻtgan
              {selected.number ? ` · raqami ${selected.number}` : ""}.
            </p>
          )}

          {result?.ok === false && (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
            >
              {result.error}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <Button
              variant="primary"
              size="xl"
              block
              loading={pending}
              onClick={() => confirmArrival(selected)}
            >
              <Check className="size-5" aria-hidden="true" />
              {moved
                ? `Keldi · ${CATEGORIES[draftCategory as keyof typeof CATEGORIES]?.name}`
                : selected.number
                  ? "Yorliqni almashtirish"
                  : "Keldi"}
            </Button>
            <Button variant="secondary" size="xl" onClick={reset} disabled={pending}>
              Orqaga
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  /* ---------------- 1-qadam: qidiruv ---------------- */
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--text-subtle)]"
          aria-hidden="true"
        />
        <label htmlFor="team-search" className="sr-only">
          Jamoa yoki ishtirokchi nomi
        </label>
        <input
          id="team-search"
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Bolaning ismi, familiyasi yoki jamoa nomi…"
          className="h-14 w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] pl-12 pr-4 text-base outline-none transition-shadow focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
        />
      </div>

      <Card className="min-h-[18rem] overflow-hidden">
        {query.trim().length < 2 ? (
          <EmptyState
            icon={<Search className="size-8" />}
            title="Jamoa nomini yozishni boshlang"
            hint="Bolaning ismi yoki familiyasini yozing — 2 harfdan natija chiqadi. Apostrof va katta harf ahamiyatsiz."
          />
        ) : searching && hits.length === 0 ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-[var(--bg-subtle)]" />
            ))}
          </div>
        ) : hits.length === 0 ? (
          <EmptyState
            title="Hech narsa topilmadi"
            hint="Boshqacha yozib koʻring yoki jamoani qoʻlda qoʻshing."
            action={
              <Button variant="primary" onClick={() => setWalkInOpen(true)}>
                <UserPlus className="size-4" aria-hidden="true" />
                Roʻyxatda yoʻq — qoʻshish
              </Button>
            }
          />
        ) : (
          <ul>
            {hits.map((hit) => (
              <li key={hit.id} className="border-b border-[var(--border)] last:border-0">
                <button
                  type="button"
                  onClick={() => openTeam(hit)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  <TeamNumber
                    value={hit.number}
                    category={isCategoryCode(hit.categoryCode) ? hit.categoryCode : undefined}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{hit.name}</span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">
                      {[hit.school, hit.coach].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  {hit.checkedInAt && <Badge tone="success">Keldi</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {hits.length > 0 && (
        <Button variant="ghost" onClick={() => setWalkInOpen(true)}>
          <UserPlus className="size-4" aria-hidden="true" />
          Roʻyxatda yoʻq — yangi jamoa qoʻshish
        </Button>
      )}

      {walkInOpen && (
        <WalkInForm
          onClose={() => setWalkInOpen(false)}
          onCreated={(res, categoryCode) => {
            setResult(res);
            setWalkInOpen(false);
            setTagCategory(categoryCode);
            setStep("tag");
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Sherik qidiruvi

   Robofutbolda bitta raqam ikki bolaga beriladi. Sherik roʻyxatda
   alohida qator boʻlib turadi — shu yerdan topib biriktiriladi.
   ============================================================ */
function PartnerPicker({
  categoryCode,
  excludeId,
  onPick,
}: {
  categoryCode: string;
  excludeId: number;
  onPick: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const requestId = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const found = await searchTeamsAction(text);
      if (id !== requestId.current) return;
      // Faqat shu yoʻnalishdagi, hali biriktirilmagan boshqa bolalar
      setHits(found.filter((h) => h.categoryCode === categoryCode && h.id !== excludeId));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, categoryCode, excludeId]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="partner-search" className="flex items-center gap-1.5 text-sm font-medium">
        <Users className="size-4 text-[var(--text-muted)]" aria-hidden="true" />
        Sherigi
        <span className="text-xs font-normal text-[var(--text-subtle)]">
          bitta raqamda ikki bola oʻynaydi
        </span>
      </label>
      <input
        id="partner-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Sherigining ismini yozing…"
        autoComplete="off"
        className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
      />

      {hits.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)]">
          {hits.map((hit) => (
            <li key={hit.id} className="border-b border-[var(--border)] last:border-0">
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                  setQuery("");
                  setHits([]);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{hit.name}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    {hit.school ?? "—"}
                  </span>
                </span>
                {hit.number && <Badge tone="neutral">{hit.number}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 && hits.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Shu yoʻnalishda bunday ishtirokchi topilmadi.
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || "—"}</dd>
    </div>
  );
}

/* ============================================================
   Raqam — eng katta shrift, uzoqdan ko'rinadi
   ============================================================ */
function NumberReveal({
  result,
  onNext,
}: {
  result: Extract<CheckInResult, { ok: true }>;
  onNext: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 py-10 text-center">
      <div className="rise-in flex flex-col items-center gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--success)]">
          Roʻyxatdan oʻtdi
        </p>
        <p className="tnum text-8xl font-bold tracking-tight sm:text-9xl">{result.number}</p>
        <p className="max-w-[30ch] text-lg text-[var(--text-muted)]">{result.name}</p>
      </div>

      <Button variant="primary" size="xl" onClick={onNext}>
        Keyingi jamoa
      </Button>
      <p className="text-xs text-[var(--text-subtle)]">
        Enter tugmasi ham keyingisiga oʻtkazadi
      </p>
    </div>
  );
}

/* ============================================================
   Yorliqni biriktirish

   Admin robotga chop etilgan qogʻozni yopishtiradi va shu koddagi
   yorliqni jamoaga bogʻlaydi. Raqam avtomatik berilmaydi — u
   jismoniy qogʻozdan keladi, shuning uchun tizim taxmin qilmaydi.
   ============================================================ */
function TagStep({
  teamId,
  teamName,
  categoryCode,
  onDone,
  onBack,
}: {
  teamId: number;
  teamName: string;
  categoryCode: string;
  onDone: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const category = isCategoryCode(categoryCode) ? CATEGORIES[categoryCode] : null;

  useEffect(() => {
    inputRef.current?.focus();
    // Boʻsh yorliqni taklif qilamiz — admin qaysi qogʻozni olishni biladi
    nextFreeTag(categoryCode).then(setSuggestion).catch(() => {});
  }, [categoryCode]);

  const submit = () => {
    if (!code.trim()) return;
    startTransition(async () => {
      setError(null);
      const res = await assignTag(teamId, code);
      if (res.ok) onDone(res.code);
      else setError(res.error);
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {category?.name ?? categoryCode}
            </p>
            <h2 className="mt-1 text-xl font-bold">{teamName}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Orqaga
          </Button>
        </div>

        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Robotga yopishtirilgan qogʻozdagi kodni kiriting.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor="tag-code" className="sr-only">
            Yorliq kodi
          </label>
          <input
            id="tag-code"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={category ? `${category.prefix}12` : "F12"}
            autoComplete="off"
            autoCapitalize="characters"
            className="tnum h-16 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 text-center text-3xl font-bold uppercase tracking-widest outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
          />

          {suggestion && !code && (
            <button
              type="button"
              onClick={() => setCode(suggestion)}
              className="self-start text-sm text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
            >
              Boʻsh yorliq: <span className="tnum font-bold">{suggestion}</span> — bosing
            </button>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
          >
            {error}
          </p>
        )}

        <Button
          variant="primary"
          size="xl"
          block
          className="mt-4"
          loading={pending}
          disabled={!code.trim()}
          onClick={submit}
        >
          <Check className="size-5" aria-hidden="true" />
          Biriktirish
        </Button>
      </Card>
    </div>
  );
}

/* ============================================================
   Webcam
   ============================================================ */
function PhotoStep({
  teamId,
  teamName,
  number,
  onDone,
  onSkip,
}: {
  teamId: number;
  teamName: string;
  number: string;
  onDone: () => void;
  onSkip: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() =>
        setError(
          "Kamera ochilmadi. HTTPS yoki localhost kerak, brauzerdan ruxsat berilganini tekshiring.",
        ),
      );

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;

    // Kenglikni 900px ga cheklaymiz — 400 ta surat ham serverni to'ldirmaydi
    const scale = Math.min(1, 900 / (video.videoWidth || 900));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((video.videoWidth || 640) * scale);
    canvas.height = Math.round((video.videoHeight || 480) * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setShot(canvas.toDataURL("image/jpeg", 0.8));
  };

  const upload = () => {
    if (!shot) return;
    startTransition(async () => {
      const res = await saveRobotPhoto(teamId, shot);
      if (res.ok) onDone();
      else setError(res.error);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <TeamNumber value={number} size="md" />
        <p className="min-w-0 flex-1 truncate font-medium">{teamName}</p>
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Suratsiz oʻtish
        </Button>
      </div>

      <Card className="overflow-hidden bg-black">
        <div className="relative aspect-[4/3] w-full">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="Olingan robot surati" className="size-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="size-full object-cover"
            />
          )}
        </div>
      </Card>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {shot ? (
          <>
            <Button variant="primary" size="xl" block loading={pending} onClick={upload}>
              <Check className="size-5" aria-hidden="true" />
              Saqlash
            </Button>
            <Button variant="secondary" size="xl" onClick={() => setShot(null)} disabled={pending}>
              <RotateCcw className="size-5" aria-hidden="true" />
              Qayta
            </Button>
          </>
        ) : (
          <Button variant="primary" size="xl" block onClick={capture} disabled={Boolean(error)}>
            <Camera className="size-5" aria-hidden="true" />
            Suratga olish
          </Button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Roʻyxatda yoʻq — qisqa forma
   ============================================================ */
function WalkInForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (
    result: Extract<CheckInResult, { ok: true }>,
    categoryCode: string,
  ) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold">Yangi jamoa</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Yopish">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <form
        className="mt-4 flex flex-col gap-3"
        action={(formData) =>
          startTransition(async () => {
            const res = await createWalkInTeam(null, formData);
            if (res.ok) onCreated(res, String(formData.get("categoryCode") ?? ""));
            else setError(res.error);
          })
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="walkin-category" className="text-sm font-medium">
            Yoʻnalish
          </label>
          <select
            id="walkin-category"
            name="categoryCode"
            required
            defaultValue=""
            className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
          >
            <option value="" disabled>
              Tanlang
            </option>
            {CATEGORY_LIST.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Stolda navbat turadi — faqat zarur maydonlar soʻraladi */}
        <TextField
          name="members"
          label="Ishtirokchilar (vergul bilan)"
          required
          hint="Robofutbolda ikki bola bitta raqam ostida oʻynaydi — ikkalasini yozing. Qolgan yoʻnalishlarda bitta."
        />
        <TextField
          name="name"
          label="Jamoa nomi"
          hint="Boʻsh qoldirsangiz birinchi ishtirokchi ismi olinadi"
        />

        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          Qoʻshish va raqam berish
        </Button>
      </form>
    </Card>
  );
}

function TextField({
  name,
  label,
  type = "text",
  required,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`walkin-${name}`} className="text-sm font-medium">
        {label}
        {!required && <span className="ml-1 text-xs text-[var(--text-subtle)]">ixtiyoriy</span>}
      </label>
      <input
        id={`walkin-${name}`}
        name={name}
        type={type}
        required={required}
        aria-describedby={hint ? `walkin-${name}-hint` : undefined}
        className="h-11 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--focus-ring)] focus:shadow-[0_0_0_3px_rgb(47_125_246/0.15)]"
      />
      {hint && (
        <p id={`walkin-${name}-hint`} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
