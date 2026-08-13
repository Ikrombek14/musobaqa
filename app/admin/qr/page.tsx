import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth/session";
import { listJudges } from "@/server/queries/admin";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import { Card } from "@/components/ui/primitives";
import { PrintButton } from "@/components/admin/print-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "QR kodlar" };

/**
 * Chop etiladigan QR kodlar.
 *
 * Bosh sahifada hakam va admin havolalari yoʻq — u faqat tomoshabin
 * uchun. Musobaqa kunida hakam telefonda manzil terib oʻtirmasligi
 * uchun QR kod maydon stoliga yoki hakam kartochkasiga yopishtiriladi.
 *
 * SVG serverda generatsiya qilinadi: mijozga JS yuklanmaydi va
 * printerda vektor sifatida toza chiqadi.
 */
async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    // Rang qora/oq — printerda eng ishonchli
    color: { dark: "#1C2027", light: "#FFFFFF" },
  });
}

export default async function QrPage() {
  const session = await getSession();
  if (!session.admin) return null;

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;

  const judgeUrl = `${base}/hakam`;
  const adminUrl = `${base}/admin`;

  const [judgeQr, adminQr, judges] = await Promise.all([
    qrSvg(judgeUrl),
    qrSvg(adminUrl),
    listJudges(),
  ]);

  const activeJudges = judges.filter((j) => j.active);

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">QR kodlar</h1>
          <p className="mt-1 max-w-[75ch] text-sm text-[var(--text-muted)]">
            Chop etib maydon stollariga va hakam kartochkalariga yopishtiring.
            Telefon kamerasini toʻgʻrilash kifoya — manzil terish shart emas.
            Bosh sahifada bu havolalar yoʻq, chunki u faqat tomoshabinlar uchun.
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Asosiy ikkita kod */}
      <div className="grid gap-5 sm:grid-cols-2">
        <QrCard
          title="Hakam paneli"
          url={judgeUrl}
          svg={judgeQr}
          hint="Har bir maydon stoliga bittadan. Hakam PIN kodi bilan kiradi."
        />
        <QrCard
          title="Tashkilotchilar"
          url={adminUrl}
          svg={adminQr}
          hint="Roʻyxatdan oʻtkazish stoli va boshqaruv. Parol bilan kiradi."
        />
      </div>

      {/* Hakamlar roʻyxati — kesib olinadigan kartochkalar */}
      {activeJudges.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="no-print text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Hakam kartochkalari · {activeJudges.length} ta
          </h2>
          <p className="no-print -mt-2 max-w-[75ch] text-sm text-[var(--text-muted)]">
            Har bir hakam uchun alohida kartochka. PIN kodni qoʻlda yozib
            qoʻying — u bazada shifrlangan holda saqlanadi va qayta
            koʻrsatilmaydi (unutilsa <strong>Hakamlar</strong> sahifasida
            yangisini berish mumkin).
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeJudges.map((judge) => {
              const category = CATEGORIES[judge.categoryCode as CategoryCode];
              return (
                <Card
                  key={judge.id}
                  className="break-inside-avoid p-4 print:border print:border-[#ccc]"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="size-24 shrink-0 [&>svg]:size-full"
                      dangerouslySetInnerHTML={{ __html: judgeQr }}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-bold">{judge.name}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {category?.name ?? judge.categoryCode}
                        {judge.fieldNo ? ` · ${judge.fieldNo}-maydon` : " · barcha maydonlar"}
                      </p>
                      <p className="mt-2 text-xs text-[var(--text-subtle)]">PIN:</p>
                      <div className="mt-0.5 h-7 w-24 rounded border border-dashed border-[var(--border-strong)]" />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function QrCard({
  title,
  url,
  svg,
  hint,
}: {
  title: string;
  url: string;
  svg: string;
  hint: string;
}) {
  return (
    <Card className="break-inside-avoid p-6 text-center">
      <h2 className="text-lg font-bold">{title}</h2>
      <div
        className="mx-auto mt-4 size-56 [&>svg]:size-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="tnum mt-4 break-all font-mono text-sm font-medium">{url}</p>
      <p className="no-print mt-2 text-sm text-[var(--text-muted)]">{hint}</p>
    </Card>
  );
}
