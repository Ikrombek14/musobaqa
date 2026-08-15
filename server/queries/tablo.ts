import "server-only";
import { asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { CATEGORIES, CATEGORY_LIST, type CategoryCode } from "@/lib/categories";
import { computeGroupTable, computeTimeRanking } from "@/lib/standings";
import { roundName } from "@/lib/draw/engine";
import { formatMs } from "@/lib/format";

/* ============================================================
   Katta ekran tablosi uchun maʼlumot
   ============================================================

   Butun ekran bitta soʻrovdan quriladi. Sabab: tablo har 5 soniyada
   yangilanadi va 5 ta yoʻnalish uchun alohida soʻrov yuborsak baza
   bekorga bezovta boʻladi. Reyting hisobi mijozda emas, shu yerda —
   ekran faqat chizadi.
   ============================================================ */

export type TabloTeamRef = { nom: string; filial: string | null; raqam: string | null };

export type TabloLive = {
  id: number;
  yonalish: CategoryCode;
  bosqich: string;
  a: TabloTeamRef | null;
  b: TabloTeamRef | null;
  hisobA: number;
  hisobB: number;
  /** Oʻyin boshlangan boʻlsa — oʻtgan soniya. Boshlanmagan boʻlsa null. */
  sekund: number | null;
  maydon: string;
  izoh: string;
};

export type TabloNext = {
  id: number;
  yonalish: CategoryCode;
  matn: string;
  izoh: string;
};

export type TabloRow = {
  teamId: number;
  jamoa: string;
  filial: string | null;
  raqam: string | null;
  /** guruh: oʻynadi/gʻalaba/farq/ochko */
  o?: number;
  g?: number;
  d?: number;
  ochko?: number;
  /** ko: gʻalaba:magʻlubiyat + holat */
  rekord?: string;
  holat?: "play" | "in" | "out";
  /** vaqt: urinishlar soni va eng yaxshi vaqt */
  urinish?: number;
  vaqt?: string;
};

export type TabloPage = { nom: string; qatorlar: TabloRow[] };

export type TabloCategory = {
  kalit: CategoryCode;
  nom: string;
  bosqich: string;
  bajarildi: number;
  jami: number;
  tur: "guruh" | "ko" | "vaqt";
  sahifalar: TabloPage[];
  keyingiOyin: string | null;
};

export type TabloData = {
  updatedAt: string;
  jamoa: number;
  oyinBajarildi: number;
  oyinJami: number;
  live: TabloLive[];
  keyingi: TabloNext[];
  yonalishlar: TabloCategory[];
  yangiliklar: { yonalish: CategoryCode; matn: string }[];
};

const teamRef = (
  t: { name: string; school: string | null; number: string | null } | null | undefined,
): TabloTeamRef | null =>
  t ? { nom: t.name, filial: t.school, raqam: t.number } : null;

export async function getTabloData(): Promise<TabloData> {
  const teamA = alias(schema.teams, "ta");
  const teamB = alias(schema.teams, "tb");

  const [teams, matchRows, groupRows, groupTeamRows, runRows, settings] =
    await Promise.all([
      db
        .select({
          id: schema.teams.id,
          categoryCode: schema.teams.categoryCode,
          name: schema.teams.name,
          number: schema.teams.number,
          school: schema.teams.school,
          numberSeq: schema.teams.numberSeq,
        })
        .from(schema.teams)
        .where(isNotNull(schema.teams.checkedInAt))
        .orderBy(asc(schema.teams.numberSeq)),

      db
        .select({
          id: schema.matches.id,
          categoryCode: schema.matches.categoryCode,
          stage: schema.matches.stage,
          groupId: schema.matches.groupId,
          round: schema.matches.round,
          slot: schema.matches.slot,
          fieldNo: schema.matches.fieldNo,
          status: schema.matches.status,
          scoreA: schema.matches.scoreA,
          scoreB: schema.matches.scoreB,
          winnerId: schema.matches.winnerId,
          isBye: schema.matches.isBye,
          walkover: schema.matches.walkover,
          thirdPlace: schema.matches.thirdPlace,
          startedAt: schema.matches.startedAt,
          finishedAt: schema.matches.finishedAt,
          teamAId: schema.matches.teamAId,
          teamBId: schema.matches.teamBId,
          groupName: schema.groups.name,
          aName: teamA.name,
          aNumber: teamA.number,
          aSchool: teamA.school,
          bName: teamB.name,
          bNumber: teamB.number,
          bSchool: teamB.school,
        })
        .from(schema.matches)
        .leftJoin(schema.groups, eq(schema.groups.id, schema.matches.groupId))
        .leftJoin(teamA, eq(teamA.id, schema.matches.teamAId))
        .leftJoin(teamB, eq(teamB.id, schema.matches.teamBId))
        .orderBy(
          asc(schema.matches.round),
          asc(schema.matches.slot),
          asc(schema.matches.id),
        ),

      db
        .select({
          id: schema.groups.id,
          categoryCode: schema.groups.categoryCode,
          name: schema.groups.name,
        })
        .from(schema.groups)
        .orderBy(asc(schema.groups.categoryCode), asc(schema.groups.name)),

      db
        .select({
          groupId: schema.groupTeams.groupId,
          teamId: schema.groupTeams.teamId,
        })
        .from(schema.groupTeams),

      db
        .select({
          teamId: schema.runs.teamId,
          attemptNo: schema.runs.attemptNo,
          finalMs: schema.runs.finalMs,
          status: schema.runs.status,
        })
        .from(schema.runs),

      db
        .select({
          code: schema.categories.code,
          drawLocked: schema.categories.drawLocked,
          advancePerGroup: schema.categories.advancePerGroup,
        })
        .from(schema.categories),
    ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const settingsByCode = new Map(settings.map((s) => [s.code, s]));

  /* ---------------- Hozir maydonda ----------------
     `status = live` ni kutib boʻlmaydi: robofutbolda hakam natijani
     bir marta bosadi va oʻyin «live» holatiga umuman tushmaydi.
     Shuning uchun har MAYDON uchun navbatdagi oʻyin olinadi — zaldagi
     odam aynan shuni koʻrib turadi. */
  const live: TabloLive[] = [];
  const seenField = new Set<string>();

  for (const m of matchRows) {
    if (m.status === "done" || m.isBye) continue;
    if (!m.teamAId || !m.teamBId) continue;

    const key = `${m.categoryCode}:${m.fieldNo ?? 0}`;
    if (seenField.has(key)) continue;
    seenField.add(key);

    const totalRounds = maxPlayoffRound(matchRows, m.categoryCode);
    live.push({
      id: m.id,
      yonalish: m.categoryCode as CategoryCode,
      bosqich: m.groupName
        ? `${m.groupName} guruh`
        : m.thirdPlace
          ? "3-oʻrin uchun"
          : roundName(m.round, totalRounds),
      a: teamRef({ name: m.aName!, school: m.aSchool, number: m.aNumber }),
      b: teamRef({ name: m.bName!, school: m.bSchool, number: m.bNumber }),
      hisobA: m.scoreA,
      hisobB: m.scoreB,
      sekund: m.startedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(m.startedAt).getTime()) / 1000))
        : null,
      maydon: m.fieldNo ? `${m.fieldNo}-maydon` : "Maydon belgilanmagan",
      izoh: CATEGORIES[m.categoryCode as CategoryCode]?.name ?? "",
    });
  }

  /* ---------------- Keyingi navbat ---------------- */
  const liveIds = new Set(live.map((l) => l.id));
  const keyingi: TabloNext[] = [];
  for (const m of matchRows) {
    if (keyingi.length >= 5) break;
    if (m.status === "done" || m.isBye || liveIds.has(m.id)) continue;
    if (!m.teamAId || !m.teamBId) continue;

    const totalRounds = maxPlayoffRound(matchRows, m.categoryCode);
    keyingi.push({
      id: m.id,
      yonalish: m.categoryCode as CategoryCode,
      matn: `${m.aNumber ?? ""} ${m.aName} — ${m.bNumber ?? ""} ${m.bName}`.trim(),
      izoh: [
        CATEGORIES[m.categoryCode as CategoryCode]?.name,
        m.groupName ? `${m.groupName} guruh` : roundName(m.round, totalRounds),
        m.fieldNo ? `${m.fieldNo}-maydon` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  /* ---------------- Yoʻnalishlar ---------------- */
  const yonalishlar: TabloCategory[] = CATEGORY_LIST.map((category) => {
    const code = category.code;
    const catTeams = teams.filter((t) => t.categoryCode === code);
    const catMatches = matchRows.filter((m) => m.categoryCode === code);
    const done = catMatches.filter((m) => m.status === "done").length;

    const upcoming = catMatches.find(
      (m) => m.status !== "done" && !m.isBye && m.teamAId && m.teamBId,
    );
    const totalRounds = maxPlayoffRound(matchRows, code);

    const keyingiOyin = upcoming
      ? `${upcoming.aNumber ?? ""} ${upcoming.aName} — ${upcoming.bNumber ?? ""} ${upcoming.bName}`.trim()
      : null;

    const locked = settingsByCode.get(code)?.drawLocked ?? false;
    const advance = settingsByCode.get(code)?.advancePerGroup ?? 1;

    /* Linefollower — vaqt reytingi */
    if (category.format === "time_trial") {
      const ranking = computeTimeRanking(
        catTeams.map((t) => ({ id: t.id, name: t.name, number: t.number })),
        runRows,
      );
      const qatorlar: TabloRow[] = ranking.map((r) => {
        const team = teamById.get(r.teamId)!;
        return {
          teamId: r.teamId,
          jamoa: team.name,
          filial: team.school,
          raqam: team.number,
          urinish: r.attempts.length,
          vaqt: r.bestMs !== null ? formatMs(r.bestMs) : r.dnfOnly ? "DNF" : "—",
        };
      });

      return {
        kalit: code,
        nom: category.name,
        bosqich: ranking.some((r) => r.attempts.length > 0) ? "Urinishlar" : "Kutilmoqda",
        bajarildi: runRows.filter((r) =>
          catTeams.some((t) => t.id === r.teamId),
        ).length,
        jami: catTeams.length * 2,
        tur: "vaqt",
        sahifalar: paginate(qatorlar, "Reyting"),
        keyingiOyin: null,
      };
    }

    /* Robofutbol — guruh jadvallari */
    if (category.format === "group_playoff") {
      const groups = groupRows.filter((g) => g.categoryCode === code);
      const hasPlayoff = catMatches.some((m) => m.stage === "playoff");

      if (groups.length > 0 && !hasPlayoff) {
        const sahifalar: TabloPage[] = groups.map((group) => {
          const ids = groupTeamRows
            .filter((gt) => gt.groupId === group.id)
            .map((gt) => gt.teamId);
          const members = ids
            .map((id) => teamById.get(id))
            .filter((t): t is NonNullable<typeof t> => Boolean(t));

          const table = computeGroupTable(
            members.map((t) => ({ id: t.id, name: t.name, number: t.number })),
            catMatches.filter((m) => m.groupId === group.id),
          );

          return {
            nom: `${group.name} guruh`,
            qatorlar: table.map((r) => {
              const team = teamById.get(r.teamId)!;
              return {
                teamId: r.teamId,
                jamoa: team.name,
                filial: team.school,
                raqam: team.number,
                o: r.played,
                g: r.won,
                d: r.diff,
                ochko: r.points,
              };
            }),
          };
        });

        return {
          kalit: code,
          nom: category.name,
          bosqich: "Guruh bosqichi",
          bajarildi: done,
          jami: catMatches.length,
          tur: "guruh",
          sahifalar,
          keyingiOyin,
        };
      }
    }

    /* Toʻr — sumo, roborace va robofutbol pleyoffi */
    const bracket = catMatches.filter((m) => m.stage === "playoff");
    const source = bracket.length > 0 ? bracket : catMatches;
    const qatorlar = knockoutRows(source, catTeams, teamById);

    return {
      kalit: code,
      nom: category.name,
      bosqich: !locked
        ? "Jerebyovka kutilmoqda"
        : bracket.length > 0
          ? deepestLabel(bracket, totalRounds)
          : "Guruh bosqichi",
      bajarildi: done,
      jami: catMatches.length,
      tur: "ko",
      sahifalar: paginate(qatorlar, "Holat"),
      keyingiOyin,
      // advance faqat guruh koʻrinishida ishlatiladi
      ...(advance ? {} : {}),
    };
  });

  /* ---------------- Soʻnggi natijalar ---------------- */
  const yangiliklar = matchRows
    .filter((m) => m.status === "done" && !m.isBye && m.finishedAt)
    .sort(
      (a, b) =>
        new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime(),
    )
    .slice(0, 8)
    .map((m) => {
      const totalRounds = maxPlayoffRound(matchRows, m.categoryCode);
      const stage = m.groupName
        ? `${m.groupName} guruh`
        : m.thirdPlace
          ? "3-oʻrin"
          : roundName(m.round, totalRounds);
      const score = m.walkover ? "texnik" : `${m.scoreA} : ${m.scoreB}`;
      return {
        yonalish: m.categoryCode as CategoryCode,
        matn: `${CATEGORIES[m.categoryCode as CategoryCode]?.name} ${stage}: ${m.aName} ${score} ${m.bName}`,
      };
    });

  return {
    updatedAt: new Date().toISOString(),
    jamoa: teams.length,
    oyinBajarildi: matchRows.filter((m) => m.status === "done").length,
    oyinJami: matchRows.length,
    live: live.slice(0, 9),
    keyingi,
    yonalishlar,
    yangiliklar,
  };
}

/* ------------------------------------------------------------------ */

function maxPlayoffRound(
  rows: { categoryCode: string; stage: string; round: number }[],
  code: string,
): number {
  return rows.reduce(
    (max, m) =>
      m.categoryCode === code && m.stage === "playoff" ? Math.max(max, m.round) : max,
    0,
  );
}

function deepestLabel(
  bracket: { round: number; status: string }[],
  totalRounds: number,
): string {
  const active = bracket.filter((m) => m.status !== "done");
  if (active.length === 0) return "Yakunlandi";
  const round = Math.min(...active.map((m) => m.round));
  return roundName(round, totalRounds);
}

/**
 * Toʻr koʻrinishi uchun qatorlar.
 *
 * Jamoalar gʻalaba soni boʻyicha tartiblanadi: tepada hali oʻyinda
 * qolganlar, pastda chiqib ketganlar. Ekranda «kim davom etyapti»
 * degan savolga javob shu.
 */
function knockoutRows(
  matches: {
    teamAId: number | null;
    teamBId: number | null;
    winnerId: number | null;
    status: string;
    isBye: boolean;
  }[],
  teams: { id: number; name: string; school: string | null; number: string | null }[],
  teamById: Map<number, { name: string; school: string | null; number: string | null }>,
): TabloRow[] {
  const stat = new Map<number, { win: number; loss: number; playing: boolean }>();
  for (const t of teams) stat.set(t.id, { win: 0, loss: 0, playing: false });

  for (const m of matches) {
    for (const id of [m.teamAId, m.teamBId]) {
      if (!id) continue;
      const row = stat.get(id);
      if (!row) continue;
      if (m.status === "done") {
        if (m.winnerId === id) row.win++;
        else if (m.winnerId !== null) row.loss++;
      } else if (!m.isBye) {
        row.playing = true;
      }
    }
  }

  return [...stat.entries()]
    .map(([teamId, s]) => {
      const team = teamById.get(teamId)!;
      return {
        teamId,
        jamoa: team.name,
        filial: team.school,
        raqam: team.number,
        rekord: `${s.win}:${s.loss}`,
        holat: (s.playing ? "in" : s.loss > 0 ? "out" : "in") as "in" | "out",
        _win: s.win,
        _playing: s.playing,
      };
    })
    .sort(
      (a, b) =>
        Number(b._playing) - Number(a._playing) ||
        b._win - a._win ||
        a.jamoa.localeCompare(b.jamoa),
    )
    .map(({ _win, _playing, ...row }) => row);
}

/** Panelga sigʻadigan qilib sahifalarga boʻladi (aylanish uchun). */
const MAX_ROWS = 6;

function paginate(rows: TabloRow[], baseName: string): TabloPage[] {
  if (rows.length === 0) return [];
  const pages: TabloPage[] = [];
  for (let i = 0; i < rows.length; i += MAX_ROWS) {
    const chunk = rows.slice(i, i + MAX_ROWS);
    pages.push({
      nom:
        rows.length <= MAX_ROWS
          ? baseName
          : `${baseName} · ${i + 1}–${Math.min(i + MAX_ROWS, rows.length)}`,
      qatorlar: chunk,
    });
  }
  return pages;
}
