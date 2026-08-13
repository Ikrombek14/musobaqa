import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { CATEGORIES, CATEGORY_LIST, categoryBySlug, type CategoryCode } from "@/lib/categories";
import { Badge, Card } from "@/components/ui/primitives";
import { PrintButton } from "@/components/admin/print-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Yorliqlar" };

/**
 * Chop etiladigan yorliqlar: raqam + QR.
 *
 * Musobaqa kunidan oldin chop etiladi va qirqiladi. Bola kelganda
 * admin robotga yopishtiradi, keyin check-in ekranida shu kodni
 * kiritib jamoaga biriktiradi.
 *
 * QR ichida `/t/<KOD>` manzili: maydonda kimdir robotning yorligʻini
 * skanerlasa, qaysi jamoa ekani chiqadi.
 */
export default async function TagsPage({ searchParams }: PageProps<"/admin/raqamlar">) {
  const session = await getSession();
  if (!session.admin) return null;

  const sp = await searchParams;
  const slug = typeof sp.yonalish === "string" ? sp.yonalish : "";
  const category = categoryBySlug(slug) ?? CATEGORIES.F;

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;

  const rows = await db
    .select({
      code: schema.tags.code,
      number: schema.tags.number,
      copies: schema.tags.copies,
      teamId: schema.tags.teamId,
      teamName: schema.teams.name,
    })
    .from(schema.tags)
    .leftJoin(schema.teams, eq(schema.teams.id, schema.tags.teamId))
    .where(eq(schema.tags.categoryCode, category.code))
    .orderBy(asc(schema.tags.number));

  // QR'lar serverda SVG sifatida — mijozga JS yuklanmaydi, printerda vektor
  const qrByCode = new Map<string, string>();
  await Promise.all(
    rows.map(async (row) => {
      qrByCode.set(
        row.code,
        await QRCode.toString(`${base}/t/${row.code}`, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 0,
          color: { dark: "#1C2027", light: "#FFFFFF" },
        }),
      );
    }),
  );

  const used = rows.filter((r) => r.teamId !== null).length;

  // Har nusxa alohida yorliq — robofutbolda ikkitadan
  const stickers = rows.flatMap((row) =>
    Array.from({ length: row.copies }, (_, copy) => ({ ...row, copy: copy + 1 })),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Yorliqlar</h1>
          <p className="mt-1 max-w-[75ch] text-sm text-[var(--text-muted)]">
            Chop eting va qirqing. Bola kelganda robotga yopishtiring, keyin
            check-in ekranida kodni kiritib jamoaga biriktiring. QR'ni
            skanerlagan odam qaysi jamoa ekanini koʻradi.
          </p>
        </div>
        <PrintButton />
      </div>

      <nav aria-label="Yoʻnalishlar" className="no-print flex flex-wrap gap-1">
        {CATEGORY_LIST.map((cat) => (
          <Link
            key={cat.code}
            href={`/admin/raqamlar?yonalish=${cat.slug}`}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
              (cat.code === category.code
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]")
            }
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: cat.colorVar }}
              aria-hidden="true"
            />
            {cat.name}
          </Link>
        ))}
      </nav>

      <div className="no-print flex flex-wrap items-center gap-3">
        <Badge tone="neutral">
          {category.prefix}1 – {category.prefix}
          {category.tagCount}
        </Badge>
        {category.copies > 1 && (
          <Badge tone="brand">{category.copies} nusxadan</Badge>
        )}
        <span className="tnum text-sm text-[var(--text-muted)]">
          {stickers.length} ta yorliq · {used} tasi biriktirilgan
        </span>
      </div>

      {/* Yorliqlar — 4 ustun, kesish uchun chegara bilan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        {stickers.map((sticker) => (
          <Card
            key={`${sticker.code}-${sticker.copy}`}
            className="break-inside-avoid flex flex-col items-center gap-2 border-dashed p-3 text-center"
          >
            <span
              className="tnum text-2xl font-bold leading-none"
              style={{ color: category.colorVar }}
            >
              {sticker.code}
            </span>
            <div
              className="size-24 [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: qrByCode.get(sticker.code) ?? "" }}
            />
            <span className="text-[10px] text-[var(--text-muted)]">
              {category.name}
              {sticker.copies > 1 ? ` · ${sticker.copy}/${sticker.copies}` : ""}
            </span>
            {sticker.teamName && (
              <span className="no-print line-clamp-1 text-[10px] font-medium text-[var(--success)]">
                {sticker.teamName}
              </span>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

export const revalidate = 0;

/** Turi TypeScript uchun — sahifa faqat admin uchun. */
export type TagCategory = CategoryCode;
