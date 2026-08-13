/**
 * Server Action argumentlarini tekshirish.
 *
 * Server Action — ochiq endpoint. Mijoz raqam yuborishi kerak boʻlgan
 * joyga string yoki `undefined` kelishi mumkin (eski tab, buzilgan
 * javob, xatolik). Shuning uchun har bir id shu yerdan oʻtkaziladi:
 * `"21"` ham, `21` ham qabul qilinadi, `"abc"` va `-1` esa yoʻq.
 */
export function toId(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isInteger(num) || num <= 0) return null;
  if (num > Number.MAX_SAFE_INTEGER) return null;
  return num;
}

/** Butun son, chegara bilan. */
export function toInt(
  value: unknown,
  { min, max }: { min: number; max: number },
): number | null {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded < min || rounded > max) return null;
  return rounded;
}
