import Link from "next/link";
import {
  Gavel,
  LayoutGrid,
  LogOut,
  ScanLine,
  Settings,
  Shuffle,
  Swords,
  Users,
} from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { adminLogout } from "@/server/actions/admin";
import { AdminLogin } from "@/components/admin/admin-login";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Boshqaruv", icon: LayoutGrid },
  { href: "/admin/checkin", label: "Check-in", icon: ScanLine },
  { href: "/admin/jamoalar", label: "Jamoalar", icon: Users },
  { href: "/admin/draw", label: "Jerebyovka", icon: Shuffle },
  { href: "/admin/juftliklar", label: "Juftliklar", icon: Swords },
  { href: "/admin/hakamlar", label: "Hakamlar", icon: Gavel },
  { href: "/admin/sozlamalar", label: "Sozlamalar", icon: Settings },
] as const;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await getSession();

  if (!session.admin) {
    return (
      <main id="main" className="flex-1">
        <AdminLogin />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            aria-label="Musobaqa admin — boshqaruv"
          >
            <Logo />
            <span className="hidden text-sm font-medium text-[var(--text-muted)] sm:inline">
              Admin
            </span>
          </Link>

          <nav aria-label="Admin boʻlimlari" className="flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-[var(--text-muted)] sm:inline">
              {session.admin.name}
            </span>
            <form action={adminLogout}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Chiqish</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
