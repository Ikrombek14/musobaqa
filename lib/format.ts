/**
 * Matn va son formatlash. Apostrof birligi: ʻ (U+02BB) — butun loyihada
 * shu belgi ishlatiladi, oddiy ' emas. Aks holda qidiruv ham, shrift ham buziladi.
 */

export const APOSTROPHE = "ʻ";

/**
 * Vaqt: mm:ss.SS (yuzdan bir soniya) — linefollower aniqligi.
 * 92_450 → "01:32.45"
 */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalHundredths = Math.round(ms / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "." +
    String(hundredths).padStart(2, "0")
  );
}

/** "01:32.45" yoki "1:32.45" yoki "92.45" → millisekund. Noto'g'ri bo'lsa null. */
export function parseTimeInput(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) return null;

  const withMinutes = /^(\d{1,3}):([0-5]?\d)(?:\.(\d{1,2}))?$/.exec(text);
  if (withMinutes) {
    const [, m, s, frac = "0"] = withMinutes;
    return (
      Number(m) * 60_000 + Number(s) * 1000 + Number(frac.padEnd(2, "0")) * 10
    );
  }

  const secondsOnly = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text);
  if (secondsOnly) {
    const [, s, frac = "0"] = secondsOnly;
    return Number(s) * 1000 + Number(frac.padEnd(2, "0")) * 10;
  }

  return null;
}

/**
 * Qidiruv uchun normallashtirish.
 * Apostrofning barcha ko'rinishlari, katta/kichik harf va ortiqcha
 * probel yo'qoladi: "Oʻzbekiston" ≡ "o'zbekiston" ≡ "ozbekiston".
 */
export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ʻ‘’'`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1 580" — probel bilan ajratilgan son */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("uz-UZ").format(value).replace(/ /g, " ");
}

/** Gol farqi: +3, 0, −2 (haqiqiy minus belgisi) */
export function formatDiff(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(d);
}

/** Uzun o'zbek ismlari uchun: "Xushnudbek Jumaniyazov" → "Xushnudbek J." */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}
