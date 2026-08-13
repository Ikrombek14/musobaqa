import { CATEGORY_LIST, isCategoryCode, type CategoryCode } from "./categories";
import { normalizeSearch } from "./format";

/**
 * Excel ustunlarini tizim maydonlariga moslash.
 *
 * Sof funksiyalar — bazasiz sinaladi. Tashkilotchining fayli qanday
 * atalganini oldindan bilmaymiz, shuning uchun avtomatik taxmin
 * qilinadi, admin esa ekranda tuzatadi.
 */

export type FieldKey =
  | "categoryCode"
  | "name"
  | "members"
  | "school"
  | "region"
  | "coach"
  | "phone";

export type Mapping = {
  categoryCode: number | null;
  name: number | null;
  /** Bir nechta ustun boʻlishi mumkin: «Ishtirokchi 1», «Ishtirokchi 2» … */
  members: number[];
  school: number | null;
  region: number | null;
  coach: number | null;
  phone: number | null;
};

export const FIELD_LABELS: Record<FieldKey, string> = {
  categoryCode: "Yoʻnalish",
  name: "Jamoa nomi",
  members: "Ishtirokchilar",
  school: "Maktab / markaz",
  region: "Viloyat",
  coach: "Murabbiy",
  phone: "Telefon",
};

/** Ustun sarlavhasidan qaysi maydon ekanini taxmin qiladi. */
const HINTS: Record<Exclude<FieldKey, "members">, string[]> = {
  categoryCode: ["yonalish", "yunalish", "kategoriya", "nominatsiya", "category", "tur"],
  name: ["jamoa", "jamoa nomi", "team", "komanda", "guruh nomi", "nomi"],
  school: ["maktab", "markaz", "school", "muassasa", "tashkilot", "oquv"],
  region: ["viloyat", "hudud", "region", "shahar", "tuman"],
  coach: ["murabbiy", "ustoz", "coach", "rahbar", "trener", "oqituvchi"],
  phone: ["telefon", "tel", "phone", "raqam", "aloqa"],
};

const MEMBER_HINTS = ["ishtirokchi", "oquvchi", "talaba", "bola", "member", "fio", "ism"];

export function suggestMapping(headers: string[]): Mapping {
  const normalized = headers.map((h) => normalizeSearch(h));
  const used = new Set<number>();

  const pick = (hints: string[]): number | null => {
    // Avval toʻliq mos kelganini, keyin ichida uchraganini olamiz
    for (const exact of [true, false]) {
      for (let i = 0; i < normalized.length; i++) {
        if (used.has(i) || !normalized[i]) continue;
        const hit = hints.some((hint) =>
          exact ? normalized[i] === hint : normalized[i].includes(hint),
        );
        if (hit) {
          used.add(i);
          return i;
        }
      }
    }
    return null;
  };

  const members: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (used.has(i) || !normalized[i]) continue;
    if (MEMBER_HINTS.some((hint) => normalized[i].includes(hint))) {
      members.push(i);
      used.add(i);
    }
  }

  return {
    categoryCode: pick(HINTS.categoryCode),
    name: pick(HINTS.name),
    members,
    school: pick(HINTS.school),
    region: pick(HINTS.region),
    coach: pick(HINTS.coach),
    phone: pick(HINTS.phone),
  };
}

/* ============================================================
   Yo'nalishni aniqlash
   ============================================================ */

/**
 * Taxalluslar. Bir-ikki harfli kodlar (R, S, L, RR) BU YERDA YOʻQ —
 * ular faqat toʻliq mos kelganda tanilishi kerak.
 *
 * ⚠️ Ilgari roʻyxatda «s» ham bor edi va qidiruv `includes` bilan
 * ketardi: natijada ichida «s» boʻlgan HAR QANDAY soʻz («shaxmat»)
 * Sumo deb tanilardi. Bunday xatoni jerebyovkadan keyin sezish
 * mumkin, shuning uchun qoida qatʼiy: qisqa taxallus — faqat aniq mos.
 */
const CATEGORY_ALIASES: Record<CategoryCode, string[]> = {
  R: ["robofutbol", "robo futbol", "futbol", "football", "soccer"],
  S: ["sumo", "robosumo", "robo sumo"],
  L: ["linefollower", "line follower", "chiziq", "line"],
  RR: ["robrace", "rob race", "poyga", "race", "racing"],
};

/** Shu uzunlikdan qisqa taxallus faqat toʻliq mos kelganda hisoblanadi. */
const MIN_PARTIAL_LENGTH = 4;

/**
 * Katakdagi matndan yoʻnalishni topadi.
 * «Robofutbol», «robo futbol», «R», «FUTBOL» — hammasi ishlaydi.
 * «shaxmat» kabi begona soʻz esa `null` qaytaradi.
 */
export function resolveCategory(value: string | null | undefined): CategoryCode | null {
  const text = normalizeSearch(String(value ?? ""));
  if (!text) return null;

  // 1) Kod sifatida yozilgan boʻlsa: r, s, l, rr — faqat aniq mos
  const upper = text.toUpperCase();
  if (isCategoryCode(upper)) return upper;

  // 2) Yoʻnalish nomi bilan aniq mos
  for (const cat of CATEGORY_LIST) {
    if (normalizeSearch(cat.name) === text) return cat.code;
  }

  // 3) Taxallus bilan aniq mos
  for (const [code, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(text)) return code as CategoryCode;
  }

  // 4) Ichida uchrasa — faqat yetarlicha uzun taxalluslar uchun
  //    («Robofutbol 6-8 yosh» kabi yozuvlar uchun kerak)
  for (const [code, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (
      aliases.some(
        (alias) => alias.length >= MIN_PARTIAL_LENGTH && text.includes(alias),
      )
    ) {
      return code as CategoryCode;
    }
  }

  return null;
}

/* ============================================================
   Qatorni jamoaga aylantirish
   ============================================================ */

export type ImportRow = string[];

export type PreparedTeam = {
  rowNumber: number;
  categoryCode: CategoryCode | null;
  name: string;
  members: string[];
  school: string | null;
  region: string | null;
  coach: string | null;
  phone: string | null;
  problem: string | null;
};

const cell = (row: ImportRow, index: number | null): string =>
  index === null ? "" : (row[index] ?? "").trim();

/**
 * Ishtirokchilarni ajratadi: bitta ustunda vergul bilan ham,
 * bir nechta ustunda alohida ham boʻlishi mumkin.
 */
function extractMembers(row: ImportRow, columns: number[]): string[] {
  const out: string[] = [];
  for (const index of columns) {
    const raw = cell(row, index);
    if (!raw) continue;
    for (const part of raw.split(/[,;\n/]+/)) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return [...new Set(out)];
}

export function prepareRow(
  row: ImportRow,
  mapping: Mapping,
  rowNumber: number,
): PreparedTeam {
  const members = extractMembers(row, mapping.members);
  const rawName = cell(row, mapping.name);
  const categoryCode = resolveCategory(cell(row, mapping.categoryCode));

  // Nom boʻsh boʻlsa birinchi ishtirokchi ismi — roʻyxatdan
  // oʻtkazish ekranidagi qoida bilan bir xil
  const name = rawName || members[0] || "";

  let problem: string | null = null;
  if (!categoryCode) {
    const raw = cell(row, mapping.categoryCode);
    problem = raw
      ? `Yoʻnalish tanilmadi: «${raw}»`
      : "Yoʻnalish koʻrsatilmagan";
  } else if (!name) {
    problem = "Jamoa nomi ham, ishtirokchi ham yoʻq";
  }

  return {
    rowNumber,
    categoryCode,
    name,
    members,
    school: cell(row, mapping.school) || null,
    region: cell(row, mapping.region) || null,
    coach: cell(row, mapping.coach) || null,
    phone: cell(row, mapping.phone) || null,
    problem,
  };
}

export function prepareRows(rows: ImportRow[], mapping: Mapping): PreparedTeam[] {
  return rows.map((row, index) => prepareRow(row, mapping, index + 2)); // +2: sarlavha qatori
}

/** Butun boʻsh qatorlarni tashlab yuboradi. */
export function dropEmptyRows(rows: ImportRow[]): ImportRow[] {
  return rows.filter((row) => row.some((c) => (c ?? "").trim() !== ""));
}
