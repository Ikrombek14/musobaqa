"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import type { TabloCategory, TabloData, TabloPage } from "@/server/queries/tablo";
import { Dots, useRotation } from "./rotating";

/** Panelga sigʻadigan qatorlar soni — serverdagi bilan bir xil. */
const MAX_ROWS = 6;

/** Bir vaqtda koʻrsatiladigan jonli oʻyin kartochkalari. */
const LIVE_SLOTS = 3;

const accent = (code: CategoryCode) => CATEGORIES[code]?.colorVar ?? "var(--text-muted)";

/* ============================================================
   Ekran
   ============================================================ */
export function TabloScreen({ initial }: { initial: TabloData }) {
  const [data, setData] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [clock, setClock] = useState<string>("");

  /* ---- 1920×1080 kanvasni ekranga moslash ---- */
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      if (stageRef.current) {
        stageRef.current.style.transform = `translate(-50%,-50%) scale(${scale})`;
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  /* ---- Soat ---- */
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      );
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  /* ---- Maʼlumot: har 5 soniyada ----
     Xato boʻlsa OXIRGI maʼlumot ekranda qoladi. Zaldagi ekran
     hech qachon oqarib ketmasligi kerak. */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/tablo/live", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as TabloData;
        if (!alive) return;
        setData(next);
        setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    };
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* ---- Jonli oʻyin sekundomeri ----
     Lokal sanaydi, har fetch'da server qiymati bilan sinxronlanadi. */
  const [tickOffset, setTickOffset] = useState(0);
  useEffect(() => setTickOffset(0), [data.updatedAt]);
  useEffect(() => {
    const id = setInterval(() => setTickOffset((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const livePages = chunk(data.live, LIVE_SLOTS);
  const liveRot = useRotation(livePages.length, 10_000);
  const shown = livePages[liveRot.index] ?? [];

  return (
    <div className="tablo">
      <div id="stage" className="tablo-stage" ref={stageRef}>
        <Header data={data} clock={clock} offline={offline} />

        <section className="tb-section">
          <div className="tb-sec">
            Hozir maydonda
            <Dots count={livePages.length} active={liveRot.index} />
          </div>
          <div className="tb-live-row">
            {shown.length === 0 ? (
              <div className="tb-empty">
                <b>Hozircha oʻyin ketmayapti</b>
                <span>
                  {data.keyingi[0]
                    ? `Keyingisi: ${data.keyingi[0].matn}`
                    : "Jerebyovka oʻtkazilgach jadval shu yerda paydo boʻladi"}
                </span>
              </div>
            ) : (
              Array.from({ length: LIVE_SLOTS }, (_, i) => {
                const match = shown[i];
                if (!match) return <div key={`gap-${i}`} aria-hidden="true" />;
                return (
                  <MatchCard
                    key={match.id}
                    match={match}
                    seconds={match.sekund === null ? null : match.sekund + tickOffset}
                    fading={liveRot.fading}
                  />
                );
              })
            )}
            <Queue data={data} />
          </div>
        </section>

        <section className="tb-section">
          <div className="tb-sec">Yoʻnalishlar boʻyicha turnir jadvali</div>
          <div className="tb-disc-row">
            {data.yonalishlar.map((cat) => (
              <DisciplinePanel key={cat.kalit} cat={cat} />
            ))}
          </div>
        </section>

        <Ticker items={data.yangiliklar} />
      </div>
    </div>
  );
}

/* ============================================================
   Header
   ============================================================ */
function Header({
  data,
  clock,
  offline,
}: {
  data: TabloData;
  clock: string;
  offline: boolean;
}) {
  return (
    <header className="tb-hdr">
      <div className="tb-brand">
        <span className="tb-logo">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 8V4" />
            <circle cx="12" cy="3" r="1.4" fill="currentColor" />
            <path d="M9 13v2M15 13v2" />
          </svg>
        </span>
        <span>
          <b>Robbit Akademiyasi</b>
          <span>Musobaqa · 2026</span>
        </span>
      </div>

      <div className="tb-title">
        <h1>Robototexnika musobaqasi</h1>
        <div className="tb-date">16-avgust, 2026 · Toshkent · 11 ta filial</div>
      </div>

      <div className="tb-hdr-right">
        <span className="tb-chip" data-offline={offline ? "true" : undefined}>
          <span className="tb-dot" />
          {offline ? "Aloqa yoʻq" : "Jonli efir"}
        </span>
        <span className="tb-stat">
          <b>{data.jamoa}</b>
          <span>Jamoa</span>
        </span>
        <span className="tb-stat">
          <b>
            {data.oyinBajarildi}/{data.oyinJami}
          </b>
          <span>Oʻyin</span>
        </span>
        <span className="tb-stat">
          <b className="tb-clock">{clock || "—"}</b>
          <span>Hozir</span>
        </span>
      </div>
    </header>
  );
}

/* ============================================================
   Jonli oʻyin
   ============================================================ */
function MatchCard({
  match,
  seconds,
  fading,
}: {
  match: TabloData["live"][number];
  seconds: number | null;
  fading: boolean;
}) {
  return (
    <div
      className="tb-match tb-fade"
      data-out={fading ? "true" : undefined}
      style={{ ["--accent" as string]: accent(match.yonalish) }}
    >
      <div className="tb-m-top">
        <span className="tb-m-tag">{CATEGORIES[match.yonalish]?.name}</span>
        <span className="tb-m-stage">{match.bosqich}</span>
        <span className="tb-m-timer" data-idle={seconds === null ? "true" : undefined}>
          {seconds === null ? "Navbatda" : <><span className="tb-dot" />{mmss(seconds)}</>}
        </span>
      </div>

      <div className="tb-m-body">
        <div className="tb-team">
          <div className="tb-t-name">{match.a?.nom ?? "—"}</div>
          <div className="tb-t-sub">
            {[match.a?.raqam, match.a?.filial].filter(Boolean).join(" · ") || " "}
          </div>
        </div>
        <div className="tb-score">
          {match.hisobA}
          <span className="sep">:</span>
          {match.hisobB}
        </div>
        <div className="tb-team r">
          <div className="tb-t-name">{match.b?.nom ?? "—"}</div>
          <div className="tb-t-sub">
            {[match.b?.raqam, match.b?.filial].filter(Boolean).join(" · ") || " "}
          </div>
        </div>
      </div>

      <div className="tb-m-foot">
        <span className="field">{match.maydon}</span>
        <span>{match.izoh}</span>
      </div>
    </div>
  );
}

function Queue({ data }: { data: TabloData }) {
  return (
    <div className="tb-queue">
      <div className="tb-q-head">Keyingi navbat</div>
      {data.keyingi.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-subtle)" }}>
          Navbatdagi oʻyin yoʻq
        </p>
      ) : (
        data.keyingi.slice(0, 4).map((item) => (
          <div className="tb-q-item" key={item.id}>
            <span className="tb-q-bar" style={{ background: accent(item.yonalish) }} />
            <span className="tb-q-txt">
              <b>{item.matn}</b>
              <span>{item.izoh}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/* ============================================================
   Yoʻnalish paneli
   ============================================================ */
function DisciplinePanel({ cat }: { cat: TabloCategory }) {
  const pages = cat.sahifalar;
  const rot = useRotation(pages.length, 8000);
  const page: TabloPage | undefined = pages[rot.index];
  const percent = cat.jami > 0 ? Math.round((cat.bajarildi / cat.jami) * 100) : 0;

  return (
    <div className="tb-disc" style={{ ["--accent" as string]: accent(cat.kalit) }}>
      <div className="tb-d-head">
        <div className="tb-d-name">{cat.nom}</div>
        <div className="tb-d-meta">
          <span className="tb-d-stage">{cat.bosqich}</span>
          <span className="tb-d-count">
            {cat.bajarildi}/{cat.jami} oʻyin
          </span>
        </div>
        <div className="tb-prog">
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>

      {page && (
        <div className="tb-pager">
          <span className="tb-pager-name" style={{ opacity: rot.fading ? 0 : 1 }}>
            {page.nom}
          </span>
          <Dots count={pages.length} active={rot.index} />
        </div>
      )}

      <div className="tb-d-body">
        {!page ? (
          <Skeleton />
        ) : (
          <div className="tb-fade" data-out={rot.fading ? "true" : undefined}>
            <Columns tur={cat.tur} />
            <div className="tb-rows">
              {padRows(page.qatorlar).map((row, i) => (
                <RowLine key={row ? row.teamId : `empty-${i}`} row={row} index={i} tur={cat.tur} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tb-d-next">
        <span className="lbl">Keyingi</span>
        <span className="val">{cat.keyingiOyin ?? "—"}</span>
      </div>
    </div>
  );
}

function Columns({ tur }: { tur: TabloCategory["tur"] }) {
  if (tur === "guruh") {
    return (
      <div className="tb-cols g-table">
        <span />
        <span>Jamoa</span>
        <span style={{ textAlign: "center" }}>O</span>
        <span style={{ textAlign: "center" }}>G</span>
        <span style={{ textAlign: "center" }}>±</span>
        <span style={{ textAlign: "center" }}>Ochko</span>
      </div>
    );
  }
  if (tur === "vaqt") {
    return (
      <div className="tb-cols g-time">
        <span />
        <span>Jamoa</span>
        <span style={{ textAlign: "center" }}>Ur.</span>
        <span style={{ textAlign: "center" }}>Vaqt</span>
      </div>
    );
  }
  return (
    <div className="tb-cols g-ko">
      <span />
      <span>Jamoa</span>
      <span style={{ textAlign: "center" }}>G:M</span>
      <span style={{ textAlign: "center" }}>Holat</span>
    </div>
  );
}

function RowLine({
  row,
  index,
  tur,
}: {
  row: TabloData["yonalishlar"][number]["sahifalar"][number]["qatorlar"][number] | null;
  index: number;
  tur: TabloCategory["tur"];
}) {
  const grid = tur === "guruh" ? "g-table" : tur === "vaqt" ? "g-time" : "g-ko";

  if (!row) {
    return (
      <div className={`tb-row ${grid}`} data-empty="true" aria-hidden="true">
        <span className="tb-pos">0</span>
        <span className="tb-nm">—</span>
        <span className="tb-num">0</span>
        <span className="tb-num">0</span>
        {tur === "guruh" && (
          <>
            <span className="tb-num">0</span>
            <span className="tb-num">0</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`tb-row ${grid}`} data-top={index < 2 ? "true" : undefined}>
      <span className="tb-pos">{index + 1}</span>
      <span className="tb-nm">
        {row.jamoa}
        {row.filial && <small>{[row.raqam, row.filial].filter(Boolean).join(" · ")}</small>}
      </span>

      {tur === "guruh" && (
        <>
          <span className="tb-num">{row.o}</span>
          <span className="tb-num">{row.g}</span>
          <span className="tb-num">{signed(row.d)}</span>
          <span className="tb-num pts">{row.ochko}</span>
        </>
      )}

      {tur === "vaqt" && (
        <>
          <span className="tb-num">{row.urinish}/2</span>
          <span className="tb-num time">{row.vaqt}</span>
        </>
      )}

      {tur === "ko" && (
        <>
          <span className="tb-num pts" style={{ fontSize: 16 }}>
            {row.rekord}
          </span>
          <span className={`tb-badge ${row.holat === "out" ? "b-out" : "b-in"}`}>
            {row.holat === "out" ? "Chiqdi" : "Davomda"}
          </span>
        </>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="tb-rows" aria-hidden="true">
      {Array.from({ length: MAX_ROWS }, (_, i) => (
        <div key={i} className="tb-skel" style={{ height: 22, margin: "9px 0" }} />
      ))}
    </div>
  );
}

/* ============================================================
   Ticker
   ============================================================ */
function Ticker({ items }: { items: TabloData["yangiliklar"] }) {
  if (items.length === 0) {
    return (
      <div className="tb-ticker">
        <div className="tb-tk-label">Soʻnggi natijalar</div>
        <div className="tb-tk-wrap">
          <span style={{ paddingLeft: 40, fontSize: 16, color: "var(--text-subtle)" }}>
            Natijalar yozila boshlagach shu yerda koʻrinadi
          </span>
        </div>
      </div>
    );
  }

  const line = items.map((item, i) => (
    <span className="tb-tk-item" key={i}>
      <i style={{ background: accent(item.yonalish) }} />
      {item.matn}
    </span>
  ));

  return (
    <div className="tb-ticker">
      <div className="tb-tk-label">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
        Soʻnggi natijalar
      </div>
      <div className="tb-tk-wrap">
        {/* Ikki nusxa — uzluksiz aylanish uchun. Ikkinchisi skrinriderdan yashirin. */}
        <div className="tb-tk-track">
          {line}
          <span aria-hidden="true" style={{ display: "contents" }}>
            {line}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function signed(value: number | undefined): string {
  if (value === undefined) return "0";
  return value > 0 ? `+${value}` : String(value);
}

/** Panel balandligi oʻzgarmasin — har doim MAX_ROWS ta qator. */
function padRows<T>(rows: T[]): (T | null)[] {
  const out: (T | null)[] = [...rows.slice(0, MAX_ROWS)];
  while (out.length < MAX_ROWS) out.push(null);
  return out;
}

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
