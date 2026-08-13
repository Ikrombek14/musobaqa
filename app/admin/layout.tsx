import Link from "next/link";
import {
  FileSpreadsheet,
  Gavel,
  LayoutGrid,
  LogOut,
  ScanLine,
  QrCode,
  Settings,
  Shuffle,
  Swords,
  Tags,
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
  { href: "/admin/import", label: "Import", icon: FileSpreadsheet },
  { href: "/admin/jamoalar", label: "Jamoalar", icon: Users },
  { href: "/admin/draw", label: "Jerebyovka", icon: Shuffle },
  { href: "/admin/juftliklar", label: "Juftliklar", icon: Swords },
  { href: "/admin/hakamlar", label: "Hakamlar", icon: Gavel },
  { href: "/admin/raqamlar", label: "Yorliqlar", icon: Tags },
  { href: "/admin/qr", label: "QR kodlar", icon: QrCode },
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
      {/*
        Sarlavha ikki qator: yuqorida brend va hisob, pastida boʻlimlar.
        Ilgari hammasi bitta qatorda edi va 10 ta boʻlim sigʻmay
        gorizontal skrollbar chiqarardi — sichqonchasiz kompyuterda
        oxirgi boʻlimlarga yetib boʻlmasdi. Endi boʻlimlar qatori
        oʻraladi (`flex-wrap`), skroll umuman yoʻq.
      */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6">
          <div className="flex h-14 items-center gap-4">
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

          <nav
            aria-label="Admin boʻlimlari"
            className="-mx-1 flex flex-wrap items-center gap-0.5 pb-2"
          >
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
