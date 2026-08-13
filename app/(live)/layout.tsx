import Link from "next/link";
import { CATEGORY_LIST } from "@/lib/categories";
import { Logo } from "@/components/ui/logo";

/**
 * Ommaviy qism: bosh sahifa va yoʻnalish tablolari.
 *
 * Quyuq sirt — katta ekranda porlamaydi, zalda yaxshi oʻqiladi.
 * Tokenlar butun loyihada bir xil, faqat sirt qatlami almashadi.
 *
 * Bu yerda hakam va admin havolalari YOʻQ: sahifa faqat tomoshabin
 * uchun. Xodimlar manzilni oʻzi kiritadi yoki QR kod orqali kiradi
 * (/admin/qr da chop etiladi).
 */
export default function LiveLayout({ children }: LayoutProps<"/"> ) {
  return (
    <div
      data-surface="tv"
      className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--text)]"
    >
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
        <nav className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            aria-label="Musobaqa — bosh sahifa"
          >
            <Logo />
          </Link>
          <span className="hidden h-4 w-px bg-[var(--border)] sm:block" aria-hidden="true" />
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              <Link
                href="/"
                className="rounded-md px-2.5 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
              >
                Hammasi
              </Link>
            </li>
            {CATEGORY_LIST.map((cat) => (
              <li key={cat.code}>
                <Link
                  href={`/jonli/${cat.slug}`}
                  className="rounded-md px-2.5 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
