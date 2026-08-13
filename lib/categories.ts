/** Yo'nalishlar — kod, nom, format va vizual rang. Yagona manba. */

export const CATEGORY_CODES = ["F", "S", "LS", "LF", "RC"] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export type CategoryFormat =
  | "group_playoff" // guruh + pleyoff (robofutbol)
  | "single_elim" // olib tashlash (sumo, roborace)
  | "time_trial"; // vaqt bo'yicha reyting (linefollower)

export type CategoryMeta = {
  code: CategoryCode;
  slug: string;
  name: string;
  format: CategoryFormat;
  /** Yorliq prefiksi: F1, S1, LS1, LF1, RC1 */
  prefix: string;
  /** Oldindan tayyorlanadigan yorliqlar soni */
  tagCount: number;
  /** Har bir raqamdan nechta nusxa chop etiladi */
  copies: number;
  colorVar: string;
};

export const CATEGORIES: Record<CategoryCode, CategoryMeta> = {
  F: {
    code: "F",
    slug: "robofutbol",
    name: "Robofutbol",
    format: "group_playoff",
    prefix: "F",
    tagCount: 50,
    // Robofutbolda jamoada ikki robot — har raqamdan ikki nusxa
    copies: 2,
    colorVar: "var(--cat-f)",
  },
  S: {
    code: "S",
    slug: "arduino-robosumo",
    name: "Arduino Robosumo",
    format: "single_elim",
    prefix: "S",
    tagCount: 50,
    copies: 1,
    colorVar: "var(--cat-s)",
  },
  LS: {
    code: "LS",
    slug: "lego-robosumo",
    name: "Lego Robosumo",
    format: "single_elim",
    prefix: "LS",
    tagCount: 50,
    copies: 1,
    colorVar: "var(--cat-ls)",
  },
  LF: {
    code: "LF",
    slug: "linefollower",
    name: "Linefollower",
    format: "time_trial",
    prefix: "LF",
    tagCount: 30,
    copies: 1,
    colorVar: "var(--cat-lf)",
  },
  RC: {
    code: "RC",
    slug: "roborace",
    name: "Roborace",
    format: "single_elim",
    prefix: "RC",
    tagCount: 50,
    copies: 1,
    colorVar: "var(--cat-rc)",
  },
};

export const CATEGORY_LIST = CATEGORY_CODES.map((c) => CATEGORIES[c]);

export function categoryBySlug(slug: string): CategoryMeta | undefined {
  return CATEGORY_LIST.find((c) => c.slug === slug);
}

export function isCategoryCode(value: string): value is CategoryCode {
  return (CATEGORY_CODES as readonly string[]).includes(value);
}

/**
 * Yorliq kodidan yoʻnalishni aniqlaydi: «LS12» → LS, «S7» → S.
 *
 * Tartib muhim: uzun prefikslar oldin tekshiriladi, aks holda «LS12»
 * dagi «S» ni topib Arduino Robosumo deb xato qaraydi.
 */
const PREFIXES_BY_LENGTH = [...CATEGORY_LIST].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

export function parseTagCode(
  raw: string,
): { categoryCode: CategoryCode; code: string; number: number } | null {
  const text = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!text) return null;

  for (const cat of PREFIXES_BY_LENGTH) {
    if (!text.startsWith(cat.prefix)) continue;
    const digits = text.slice(cat.prefix.length);
    if (!/^\d{1,3}$/.test(digits)) continue;
    const number = Number(digits);
    if (number < 1) continue;
    return { categoryCode: cat.code, code: `${cat.prefix}${number}`, number };
  }
  return null;
}

/** Linefollower jarimasi: har chiqish +5 soniya */
export const PENALTY_MS = 5000;

/** Robofutbol ochkolari */
export const POINTS = { win: 3, draw: 1, loss: 0 } as const;
