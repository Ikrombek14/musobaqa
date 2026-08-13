import { cn } from "@/lib/cn";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";

/* ---------------- Card ---------------- */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]",
        className,
      )}
      {...props}
    />
  );
}

/* ---------------- Badge ---------------- */
export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning" | "danger" | "brand";
}) {
  const tones = {
    neutral: "bg-[var(--bg-subtle)] text-[var(--text-muted)]",
    success: "bg-[var(--success-soft)] text-[var(--success)]",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
    brand: "bg-[var(--brand-soft)] text-[var(--warning)]",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ---------------- Jamoa raqami ----------------
   Musobaqadagi eng ko'p o'qiladigan element. Monospace kenglik —
   R7 va R12 bir xil joy egallaydi, ro'yxat sakramaydi. */
export function TeamNumber({
  value,
  category,
  size = "md",
}: {
  value: string | null;
  category?: CategoryCode;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "text-xs px-1.5 py-0.5 min-w-[2.5rem]",
    md: "text-sm px-2 py-1 min-w-[3rem]",
    lg: "text-2xl px-3 py-1.5 min-w-[4.5rem]",
  } as const;

  if (!value) {
    return (
      <span
        className={cn(
          "tnum inline-flex items-center justify-center rounded-[var(--radius-sm)] " +
            "border border-dashed border-[var(--border-strong)] text-[var(--text-subtle)]",
          sizes[size],
        )}
        title="Raqam check-in paytida beriladi"
      >
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        "tnum inline-flex items-center justify-center rounded-[var(--radius-sm)] font-bold text-white",
        sizes[size],
      )}
      style={{ backgroundColor: category ? CATEGORIES[category].colorVar : "var(--text)" }}
    >
      {value}
    </span>
  );
}

/* ---------------- Bo'sh holat ----------------
   "Ma'lumot yo'q" yetarli emas: nima qilish kerakligi yoziladi. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-[var(--text-subtle)]">{icon}</div>}
      <p className="text-base font-semibold text-[var(--text)]">{title}</p>
      {hint && <p className="max-w-[42ch] text-sm text-[var(--text-muted)]">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ---------------- Jonli indikator ----------------
   Faqat rostdan ulangan bo'lsa yashil va pulsatsiyalanadi. */
export function LiveDot({ status }: { status: "connecting" | "live" | "offline" }) {
  const map = {
    live: { color: "var(--success)", label: "Jonli", pulse: true },
    connecting: { color: "var(--warning)", label: "Ulanmoqda", pulse: false },
    offline: { color: "var(--danger)", label: "Ulanish yoʻq", pulse: false },
  } as const;
  const s = map[status];

  return (
    <span
      className="inline-flex items-center gap-2 text-xs font-semibold"
      style={{ color: s.color }}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn("size-2 rounded-full", s.pulse && "live-dot")}
        style={{ backgroundColor: s.color }}
        aria-hidden="true"
      />
      {s.label}
    </span>
  );
}

/* ---------------- Yo'nalish chipi ---------------- */
export function CategoryChip({ code }: { code: CategoryCode }) {
  const cat = CATEGORIES[code];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: cat.colorVar }}
    >
      {cat.name}
    </span>
  );
}
