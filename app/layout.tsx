import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/* Inter — Lotin + Kirill + ʻ (U+02BB) ni qo'llab-quvvatlaydi */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Musobaqa",
    template: "%s · Musobaqa",
  },
  description:
    "Robototexnika musobaqasi: roʻyxatdan oʻtish, jerebyovka, hakamlik va jonli natijalar.",
  applicationName: "Musobaqa",
  openGraph: {
    title: "Musobaqa",
    description: "Robototexnika musobaqasi — jonli natijalar va jadval.",
    type: "website",
    locale: "uz_UZ",
  },
};

export const viewport: Viewport = {
  themeColor: "#1c2027",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="uz" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-ink"
        >
          Asosiy kontentga oʻtish
        </a>
        {children}
      </body>
    </html>
  );
}
