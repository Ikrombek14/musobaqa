import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { CATEGORIES, parseTagCode } from "@/lib/categories";
import { roundName } from "@/lib/draw/engine";
import { Badge, Card, EmptyState, TeamNumber } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Yorliq", robots: { index: false } };

/**
 * Yorliq QR'i shu sahifaga olib keladi.
 *
 * Asosiy foydalanuvchi — maydondagi hakam: robotdagi qogʻozni telefoni
 * bilan skanerlaydi va «bu kim» degan savolga darhol javob oladi.
 * Shuning uchun sahifa telefon uchun qurilgan: bitta ustun, katta
 * shrift, eng kerakli maʼlumot tepada.
 *
 * Robot surati faqat xodimlarga koʻrinadi (`/api/photo` sessiya
 * talab qiladi) — bolalarning surati ochiq internetda turmasin.
 */
export default async function TagPage({ params }: PageProps<"/t/[code]">) {
  const { code } = await params;
  const parsed = parseTagCode(decodeURIComponent(code));
  if (!parsed) notFound();

  const category = CATEGORIES[parsed.categoryCode];
  const session = await getSession();
  const isStaff = Boolean(session.admin || session.judge);

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

  if (row.teamId === null) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
        <div className="flex justify-center">
          <TeamNumber value={row.code} category={parsed.categoryCode} size="lg" />
        </div>
        <Card>
          <EmptyState
            title="Yorliq hali biriktirilmagan"
            hint={`${category.name} · ${row.code}. Roʻyxatdan oʻtkazish stolida jamoaga biriktiriladi.`}
          />
        </Card>
      </div>
    );
  }

  const teamId = row.teamId;
  const teamA = alias(schema.teams, "ta");
  const teamB = alias(schema.teams, "tb");

  const [members, photo, matches] = await Promise.all([
    db
      .select({ fullName: schema.participants.fullName })
      .from(schema.participants)
      .where(eq(schema.participants.teamId, teamId))
      .orderBy(asc(schema.participants.id)),

    isStaff
      ? db
          .select({ photoPath: schema.robots.photoPath })
          .from(schema.robots)
          .where(eq(schema.robots.teamId, teamId))
          .orderBy(asc(schema.robots.capturedAt))
          .then((rows) => rows.at(-1) ?? null)
      : Promise.resolve(null),

    db
      .select({
        id: schema.matches.id,
        stage: schema.matches.stage,
        round: schema.matches.round,
        status: schema.matches.status,
        fieldNo: schema.matches.fieldNo,
        scoreA: schema.matches.scoreA,
        scoreB: schema.matches.scoreB,
        winnerId: schema.matches.winnerId,
        walkover: schema.matches.walkover,
        thirdPlace: schema.matches.thirdPlace,
        teamAId: schema.matches.teamAId,
        groupName: schema.groups.name,
        aName: teamA.name,
        aNumber: teamA.number,
        bName: teamB.name,
        bNumber: teamB.number,
      })
      .from(schema.matches)
      .leftJoin(schema.groups, eq(schema.groups.id, schema.matches.groupId))
      .leftJoin(teamA, eq(teamA.id, schema.matches.teamAId))
      .leftJoin(teamB, eq(teamB.id, schema.matches.teamBId))
      .where(
        or(eq(schema.matches.teamAId, teamId), eq(schema.matches.teamBId, teamId)),
      )
      .orderBy(asc(schema.matches.stage), asc(schema.matches.round), asc(schema.matches.slot)),
  ]);

  const totalRounds = matches.reduce(
    (max, m) => (m.stage === "playoff" ? Math.max(max, m.round) : max),
    0,
  );
  const next = matches.find((m) => m.status !== "done");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
      {/* Raqam va yoʻnalish — skanerlagan odam avval shuni izlaydi */}
      <div className="flex items-center gap-3">
        <TeamNumber value={row.code} category={parsed.categoryCode} size="lg" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {category.name}
          </p>
          <h1 className="text-xl font-bold leading-tight">{row.teamName}</h1>
        </div>
      </div>

      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/photo/${encodeURIComponent(photo.photoPath)}`}
          alt={`${row.teamName} roboti`}
          className="aspect-[4/3] w-full rounded-[var(--radius-lg)] border border-[var(--border)] object-cover"
        />
      )}

      <Card className="p-4">
        {members.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {members.length > 1 ? "Ishtirokchilar" : "Ishtirokchi"}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {members.map((m) => (
                <li key={m.fullName} className="text-lg font-semibold leading-snug">
                  {m.fullName}
                </li>
              ))}
            </ul>
          </>
        )}

        {(row.school || row.region) && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {[row.school, row.region].filter(Boolean).join(" · ")}
          </p>
        )}

        {!photo && isStaff && (
          <p className="mt-3 text-sm text-[var(--text-subtle)]">Robot surati olinmagan</p>
        )}
      </Card>

      {/* Keyingi oʻyin — hakamga eng kerakli maʼlumot */}
      {next && (
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Keyingi oʻyin
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-base font-bold">
              {next.groupName
                ? `${next.groupName} guruh`
                : next.thirdPlace
                  ? "3-oʻrin uchun"
                  : roundName(next.round, totalRounds)}
            </span>
            {next.fieldNo && <Badge tone="brand">{next.fieldNo}-maydon</Badge>}
            {next.status === "live" && <Badge tone="warning">Ketmoqda</Badge>}
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Raqib:{" "}
            <span className="font-semibold text-[var(--text)]">
              {next.teamAId === teamId
                ? `${next.bNumber ?? ""} ${next.bName ?? "kutilmoqda"}`
                : `${next.aNumber ?? ""} ${next.aName ?? "kutilmoqda"}`}
            </span>
          </p>
        </Card>
      )}

      {matches.some((m) => m.status === "done") && (
        <Card className="overflow-hidden">
          <p className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Oʻynalgan oʻyinlar
          </p>
          <ul>
            {matches
              .filter((m) => m.status === "done")
              .map((m) => {
                const mine = m.teamAId === teamId;
                const won = m.winnerId === teamId;
                return (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                      {mine ? m.bNumber : m.aNumber} {mine ? m.bName : m.aName}
                    </span>
                    <span className="tnum font-bold">
                      {m.walkover
                        ? won
                          ? "TM"
                          : "—"
                        : mine
                          ? `${m.scoreA}:${m.scoreB}`
                          : `${m.scoreB}:${m.scoreA}`}
                    </span>
                    <Badge tone={won ? "success" : "neutral"}>{won ? "gʻalaba" : "magʻlub"}</Badge>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}

      <Link
        href={`/jonli/${category.slug}`}
        className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand)] text-sm font-semibold text-[var(--brand-ink)]"
      >
        {category.name} natijalari
      </Link>
    </div>
  );
}
