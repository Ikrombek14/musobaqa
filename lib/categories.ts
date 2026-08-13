/** Yo'nalishlar — kod, nom, format va vizual rang. Yagona manba. */

export const CATEGORY_CODES = ["R", "S", "L", "RR"] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export type CategoryFormat =
  | "group_playoff" // guruh + pleyoff (robofutbol)
  | "single_elim" // olib tashlash (sumo, robrace)
  | "time_trial"; // vaqt bo'yicha reyting (linefollower)

export type CategoryMeta = {
  code: CategoryCode;
  slug: string;
  name: string;
  format: CategoryFormat;
  /** Raqam prefiksi: R01, S01, L01, RR01 */
  prefix: string;
  colorVar: string;
};

export const CATEGORIES: Record<CategoryCode, CategoryMeta> = {
  R: {
    code: "R",
    slug: "robofutbol",
    name: "Robofutbol",
    format: "group_playoff",
    prefix: "R",
    colorVar: "var(--cat-r)",
  },
  S: {
    code: "S",
    slug: "sumo",
    name: "Sumo",
    format: "single_elim",
    prefix: "S",
    colorVar: "var(--cat-s)",
  },
  L: {
    code: "L",
    slug: "linefollower",
    name: "Linefollower",
    format: "time_trial",
    prefix: "L",
    colorVar: "var(--cat-l)",
  },
  RR: {
    code: "RR",
    slug: "robrace",
    name: "Robrace",
    format: "single_elim",
    prefix: "RR",
    colorVar: "var(--cat-rr)",
  },
};

export const CATEGORY_LIST = CATEGORY_CODES.map((c) => CATEGORIES[c]);

export function categoryBySlug(slug: string): CategoryMeta | undefined {
  return CATEGORY_LIST.find((c) => c.slug === slug);
}

export function isCategoryCode(value: string): value is CategoryCode {
  return (CATEGORY_CODES as readonly string[]).includes(value);
}

/** Linefollower jarimasi: har chiqish +5 soniya */
export const PENALTY_MS = 5000;

/** Robofutbol ochkolari */
export const POINTS = { win: 3, draw: 1, loss: 0 } as const;
