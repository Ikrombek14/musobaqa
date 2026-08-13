import { createRng, shuffle } from "./rng";

/**
 * Jerebyovka dvigateli — sof funksiyalar, bazaga bog'liq emas.
 * Bir xil seed + bir xil kirish → har doim bir xil natija.
 */

export type DrawTeam = {
  id: number;
  name: string;
  school?: string | null;
};

/* ============================================================
   Guruh jerebyovkasi (robofutbol)
   ============================================================ */

export type GroupResult = {
  /** "A", "B", ... */
  name: string;
  teamIds: number[];
};

export type GroupDrawResult = {
  groups: GroupResult[];
  warnings: string[];
};

const GROUP_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function groupLabel(index: number): string {
  if (index < 26) return GROUP_NAMES[index];
  // 26 tadan oshsa: AA, AB, ...
  const first = Math.floor(index / 26) - 1;
  return GROUP_NAMES[first] + GROUP_NAMES[index % 26];
}

/**
 * Jamoalarni guruhlarga bo'ladi.
 *
 * Himoya qoidasi: bitta maktabning ikki jamoasi bitta guruhga tushmasin.
 * Iloji bo'lmasa (masalan bitta maktabdan 5 jamoa, guruh 4 talik) —
 * imkon qadar tarqatadi va ogohlantirish qaytaradi. Jerebyovka
 * TO'XTAMAYDI: musobaqa kuni to'xtab qolgan tizim eng yomon variant.
 */
export function drawGroups(
  teams: readonly DrawTeam[],
  groupSize: number,
  seed: string,
): GroupDrawResult {
  const warnings: string[] = [];

  if (teams.length === 0) return { groups: [], warnings: ["Jamoa yoʻq"] };
  if (groupSize < 2) throw new Error("Guruh oʻlchami kamida 2 boʻlishi kerak");

  const rng = createRng(seed);
  const groupCount = Math.max(1, Math.ceil(teams.length / groupSize));

  // Bir maktabdan kelgan jamoalar ketma-ket tushmasligi uchun avval
  // maktablar bo'yicha to'plab, keyin navbatma-navbat tarqatamiz.
  const bySchool = new Map<string, DrawTeam[]>();
  for (const team of shuffle(teams, rng)) {
    const key = normalizeSchool(team.school);
    const list = bySchool.get(key);
    if (list) list.push(team);
    else bySchool.set(key, [team]);
  }

  // Katta maktablar birinchi joylashsin — ular eng qattiq cheklov.
  const queues = shuffle([...bySchool.entries()], rng).sort(
    (a, b) => b[1].length - a[1].length,
  );

  const buckets: DrawTeam[][] = Array.from({ length: groupCount }, () => []);
  const schoolsIn: Set<string>[] = Array.from({ length: groupCount }, () => new Set());

  for (const [school, list] of queues) {
    for (const team of list) {
      const index = pickGroup(buckets, schoolsIn, school, groupSize);
      buckets[index].push(team);
      if (school) {
        if (schoolsIn[index].has(school)) {
          warnings.push(
            `«${school}» maktabining bir nechta jamoasi ${groupLabel(index)} guruhida — ` +
              `guruhlar soni yetmadi.`,
          );
        }
        schoolsIn[index].add(school);
      }
    }
  }

  return {
    groups: buckets.map((bucket, i) => ({
      name: groupLabel(i),
      teamIds: bucket.map((t) => t.id),
    })),
    warnings: [...new Set(warnings)],
  };
}

function normalizeSchool(school: string | null | undefined): string {
  return (school ?? "").trim().toLowerCase();
}

/**
 * Jamoa uchun eng mos guruh:
 *   1) maktabi hali yo'q va joyi bor guruhlar ichidan eng bo'shi
 *   2) bo'lmasa — umuman joyi bor eng bo'sh guruh
 *   3) bo'lmasa — eng kam to'lgan guruh (guruh o'lchami oshadi)
 */
function pickGroup(
  buckets: DrawTeam[][],
  schoolsIn: Set<string>[],
  school: string,
  groupSize: number,
): number {
  let best = -1;
  let bestCount = Infinity;

  if (school) {
    for (let i = 0; i < buckets.length; i++) {
      if (schoolsIn[i].has(school)) continue;
      if (buckets[i].length >= groupSize) continue;
      if (buckets[i].length < bestCount) {
        best = i;
        bestCount = buckets[i].length;
      }
    }
    if (best !== -1) return best;
  }

  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].length >= groupSize) continue;
    if (buckets[i].length < bestCount) {
      best = i;
      bestCount = buckets[i].length;
    }
  }
  if (best !== -1) return best;

  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].length < bestCount) {
      best = i;
      bestCount = buckets[i].length;
    }
  }
  return best;
}

/* ============================================================
   Guruh ichidagi round-robin (har kim har kim bilan)
   ============================================================ */

export type Pairing = { a: number; b: number; round: number };

/**
 * Aylana usuli. Toq sonda jamoa bo'lsa bittasi har turda dam oladi.
 * Turlar bo'yicha ajratish jadval tuzishda kerak: bir jamoa ketma-ket
 * ikki o'yin o'ynab qolmasin.
 */
export function roundRobin(teamIds: readonly number[]): Pairing[] {
  const ids = teamIds.slice();
  if (ids.length < 2) return [];

  const bye = -1;
  if (ids.length % 2 === 1) ids.push(bye);

  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const rotating = ids.slice(1);
  const pairings: Pairing[] = [];

  for (let r = 0; r < rounds; r++) {
    const line = [ids[0], ...rotating];
    for (let i = 0; i < half; i++) {
      const a = line[i];
      const b = line[n - 1 - i];
      if (a === bye || b === bye) continue;
      // Uy/mehmon navbatlashsin — bir jamoa hamma vaqt chapda turmasin
      pairings.push(r % 2 === 0 ? { a, b, round: r + 1 } : { a: b, b: a, round: r + 1 });
    }
    rotating.unshift(rotating.pop()!);
  }

  return pairings;
}

/* ============================================================
   Olib tashlash to'ri (sumo, robrace, pleyoff)
   ============================================================ */

export type BracketMatch = {
  round: number; // 1 = birinchi bosqich
  slot: number; // 0-dan boshlab, tur ichidagi tartib
  teamAId: number | null;
  teamBId: number | null;
  /** Raqibsiz o'tish — avtomatik yopiladi, hakam kutmaydi */
  isBye: boolean;
  nextRound: number | null;
  nextSlot: number | null;
  nextSide: "a" | "b" | null;
};

export type BracketResult = {
  matches: BracketMatch[];
  totalRounds: number;
  size: number;
  byes: number;
};

/**
 * Single elimination to'ri.
 *
 * Ishtirokchilar soni 2 ning darajasi bo'lmasa, yetishmagan joylarga bay
 * qo'yiladi. Baylar to'r bo'ylab TARQATILADI (hammasi bir tomonda emas) —
 * aks holda to'rning yarmi bir tur oldinda ketib qoladi.
 */
export function buildBracket(teamIds: readonly number[], seed: string): BracketResult {
  const rng = createRng(seed);
  const order = shuffle(teamIds, rng);
  const n = order.length;

  if (n === 0) return { matches: [], totalRounds: 0, size: 0, byes: 0 };
  if (n === 1) {
    return {
      matches: [
        {
          round: 1,
          slot: 0,
          teamAId: order[0],
          teamBId: null,
          isBye: true,
          nextRound: null,
          nextSlot: null,
          nextSide: null,
        },
      ],
      totalRounds: 1,
      size: 1,
      byes: 1,
    };
  }

  const size = 2 ** Math.ceil(Math.log2(n));
  const totalRounds = Math.log2(size);
  const byes = size - n;

  // Standart to'r tartibi: 1–size, 2–(size-1) ... Bay oladigan pozitsiyalar
  // shu tartibda birinchi bo'lib chiqadi, ya'ni to'r bo'ylab tarqaladi.
  const positions = seedPositions(size);
  const slots: (number | null)[] = new Array(size).fill(null);

  // byes ta pozitsiyaga raqib qo'yilmaydi
  let teamIndex = 0;
  const byePositions = new Set(positions.slice(0, byes).map((p) => partnerOf(p)));

  for (let i = 0; i < size; i++) {
    if (byePositions.has(i)) continue;
    slots[i] = order[teamIndex++] ?? null;
  }
  // Bay olganlar
  for (const p of positions.slice(0, byes)) {
    if (slots[p] === null && teamIndex < n) slots[p] = order[teamIndex++];
  }
  // Qolgan bo'sh joylarga (agar bo'lsa) qolganlarni joylaymiz
  for (let i = 0; i < size && teamIndex < n; i++) {
    if (slots[i] === null && !byePositions.has(i)) slots[i] = order[teamIndex++];
  }

  const matches: BracketMatch[] = [];

  // 1-tur
  for (let slot = 0; slot < size / 2; slot++) {
    const a = slots[slot * 2];
    const b = slots[slot * 2 + 1];
    const nextRound = totalRounds > 1 ? 2 : null;
    matches.push({
      round: 1,
      slot,
      teamAId: a,
      teamBId: b,
      isBye: a === null || b === null,
      nextRound,
      nextSlot: nextRound ? Math.floor(slot / 2) : null,
      nextSide: nextRound ? (slot % 2 === 0 ? "a" : "b") : null,
    });
  }

  // Keyingi turlar — bo'sh, g'oliblar bilan to'ladi
  for (let round = 2; round <= totalRounds; round++) {
    const count = size / 2 ** round;
    for (let slot = 0; slot < count; slot++) {
      const nextRound = round < totalRounds ? round + 1 : null;
      matches.push({
        round,
        slot,
        teamAId: null,
        teamBId: null,
        isBye: false,
        nextRound,
        nextSlot: nextRound ? Math.floor(slot / 2) : null,
        nextSide: nextRound ? (slot % 2 === 0 ? "a" : "b") : null,
      });
    }
  }

  return { matches, totalRounds, size, byes };
}

/** Juftining ikkinchi pozitsiyasi (0↔1, 2↔3, ...) */
function partnerOf(position: number): number {
  return position % 2 === 0 ? position + 1 : position - 1;
}

/**
 * Klassik to'r tartibi: [0, size-1, size/2, ...] — kuchlilar bir-biridan
 * uzoqda turadi. Bu yerda reyting yo'q, lekin BAYLARNI tarqatish uchun
 * ayni shu tartib kerak.
 */
function seedPositions(size: number): number[] {
  let list = [0];
  for (let round = 1; round < Math.log2(size) + 1; round++) {
    const length = list.length * 2;
    const next: number[] = [];
    for (const value of list) {
      next.push(value);
      next.push(length - 1 - value);
    }
    list = next;
  }
  return list;
}

/**
 * Turning nomi: "Final", "Yarim final", "Chorak final", "1/8 final" …
 *
 * `fromEnd` — finalgacha necha bosqich qolgani. 16 talik toʻrda birinchi
 * tur 8 ta uchrashuvdan iborat, ya'ni "1/8 final": bo'luvchi 2^fromEnd.
 * (Chorak final = 1/4, ya'ni fromEnd 2 → 2² = 4 — mos keladi.)
 */
export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd <= 0) return "Final";
  if (fromEnd === 1) return "Yarim final";
  if (fromEnd === 2) return "Chorak final";
  return `1/${2 ** fromEnd} final`;
}
