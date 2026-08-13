import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Bitta ekranda faqat BITTA primary tugma bo'ladi.
 * Barcha holatlar shu yerda yopilgan: hover / focus-visible / active /
 * disabled / loading. Loading paytida kenglik o'zgarmaydi — layout sakramaydi.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold " +
    "transition-[background-color,border-color,color,transform] duration-150 " +
    "select-none whitespace-nowrap " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] " +
    "disabled:opacity-50 disabled:pointer-events-none " +
    "active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--brand)] text-[var(--brand-ink)] hover:bg-[var(--brand-hover)] shadow-[var(--shadow-sm)]",
        secondary:
          "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--bg-subtle)]",
        ghost: "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]",
        danger: "bg-[var(--danger)] text-white hover:brightness-95",
        success: "bg-[var(--success)] text-white hover:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        xl: "h-16 px-8 text-lg", // hakam paneli — qo'lqopda ham bosiladi
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "md", block: false },
  },
);

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { loading?: boolean };

export function Button({
  className,
  variant,
  size,
  block,
  loading,
  disabled,
  children,
  ...props
}: Props) {
  return (
    <button
      className={cn(button({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
