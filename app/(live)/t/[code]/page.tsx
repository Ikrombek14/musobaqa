import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CATEGORIES, parseTagCode } from "@/lib/categories";
import { Card, EmptyState, TeamNumber } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Yorliq", robots: { index: false } };

/**
 * Yorliq QR'i shu sahifaga olib keladi.
 *
 * Maydonda robotning qogʻozini skanerlagan odam qaysi jamoa ekanini
 * koʻradi. Ommaviy sahifa — telefon raqami va shunga oʻxshash shaxsiy
 * maʼlumot koʻrsatilmaydi.
 */
export default async function TagPage({ params }: PageProps<"/t/[code]">) {
  const { code } = await params;
  const parsed = parseTagCode(decodeURIComponent(code));
  if (!parsed) notFound();

  const category = CATEGORIES[parsed.categoryCode];

  const [row] = await db
    .select({
      code: schema.tags.code,
      teamId: schema.tags.teamId,
      teamName: schema.teams.name,
      school: schema.teams.school,
      region: schema.teams.region,
    })
    .from(schema.tags)
    .leftJoin(schema.teams, eq(schema.teams.id, schema.tags.teamId))
    .where(
      and(
        eq(schema.tags.categoryCode, parsed.categoryCode),
        eq(schema.tags.code, parsed.code),
      ),
    );

  if (!row) notFound();

  const members = row.teamId
    ? await db
        .select({ fullName: schema.participants.fullName })
        .from(schema.participants)
        .where(eq(schema.participants.teamId, row.teamId))
    : [];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
      <div className="flex items-center justify-center gap-3">
        <TeamNumber value={row.code} category={parsed.categoryCode} size="lg" />
      </div>

      {row.teamId === null ? (
        <Card>
          <EmptyState
            title="Yorliq hali biriktirilmagan"
            hint={`${category.name} · ${row.code}. Roʻyxatdan oʻtkazish stolida jamoaga biriktiriladi.`}
          />
        </Card>
      ) : (
        <Card className="p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {category.name}
          </p>
          <h1 className="mt-2 text-2xl font-bold">{row.teamName}</h1>

          {members.length > 0 && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              {members.map((m) => m.fullName).join(", ")}
            </p>
          )}
          {(row.school || row.region) && (
            <p className="mt-1 text-sm text-[var(--text-subtle)]">
              {[row.school, row.region].filter(Boolean).join(" · ")}
            </p>
          )}

          <Link
            href={`/jonli/${category.slug}`}
            className="mt-5 inline-flex h-11 items-center rounded-[var(--radius-md)] bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--brand-ink)]"
          >
            {category.name} natijalari
          </Link>
        </Card>
      )}
    </div>
  );
}
