import { cn } from "@/lib/cn";

/**
 * Logotip: pyedestal belgisi + «Musobaqa» soʻzi.
 *
 * Belgi uchta ustundan iborat — gʻoliblar pyedestali. Faqat `currentColor`
 * va brend rangi ishlatiladi, shuning uchun yorugʻ va quyuq sirtda ham,
 * kichik oʻlchamda ham bir xil oʻqiladi.
 */
export function Logo({
  className,
  showText = true,
  accent = "var(--brand)",
}: {
  className?: string;
  showText?: boolean;
  accent?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 24 24"
        className="size-6 shrink-0"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Chap ustun — 2-oʻrin */}
        <rect x="1" y="11" width="6" height="11" rx="1.5" fill="currentColor" opacity="0.45" />
        {/* Oʻrta ustun — 1-oʻrin, brend rangida */}
        <rect x="9" y="5" width="6" height="17" rx="1.5" fill={accent} />
        {/* Oʻng ustun — 3-oʻrin */}
        <rect x="17" y="14" width="6" height="8" rx="1.5" fill="currentColor" opacity="0.3" />
        {/* Gʻolib ustidagi nuqta */}
        <circle cx="12" cy="2.4" r="1.9" fill={accent} />
      </svg>

      {showText && (
        <span className="text-sm font-bold tracking-tight">Musobaqa</span>
      )}
    </span>
  );
}
