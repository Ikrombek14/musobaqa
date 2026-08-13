import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <p className="tnum text-5xl font-bold text-[var(--text-subtle)]">404</p>
      <h1 className="text-xl font-bold">Sahifa topilmadi</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Manzil notoʻgʻri boʻlishi mumkin.
      </p>
      <Link
        href="/"
        className="inline-flex h-11 items-center rounded-[var(--radius-md)] bg-[var(--brand)] px-5 font-semibold text-[var(--brand-ink)] transition-colors hover:bg-[var(--brand-hover)]"
      >
        Bosh sahifaga
      </Link>
    </main>
  );
}
