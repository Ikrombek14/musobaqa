import "server-only";
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { CATEGORIES, type CategoryCode } from "@/lib/categories";
import { computeGroupTable } from "@/lib/standings";
import { buildBracket } from "@/lib/draw/engine";
import { createSeed } from "@/lib/draw/rng";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ============================================================
   To'rni bazaga yozish
   ============================================================ */

/**
 * `buildBracket` natijasini `matches` jadvaliga yozadi va simlarni ulaydi.
 *
 * Uch qadam ketma-ket: (1) qatorlar — id olish uchun, (2) next_match_id
 * simlari, (3) bay olganlarni keyingi bosqichga koʻchirish. Simlarni
 * birinchi qadamda ulab boʻlmaydi, chunki keyingi oʻyinning id'si hali yoʻq.
 */
export async function insertBracket(
  tx: Tx,
  categoryCode: CategoryCode,
  stage: "playoff",
  bracket: ReturnType<typeof buildBracket>,
  fieldCount: number,
): Promise<Map<string, number>> {
  const fields = Math.max(1, fieldCount);
  const idByKey = new Map<string, number>();
  let orderNo = 0;

  for (const match of bracket.matches) {
    const [row] = await tx
      .insert(schema.matches)
      .values({
        categoryCode,
        stage,
        round: match.round,
        slot: match.slot,
        orderNo,
        fieldNo: match.round === 1 && !match.isBye ? (orderNo % fields) + 1 : null,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        isBye: match.isBye,
        status: match.isBye ? "done" : "pending",
        winnerId: match.isBye ? (match.teamAId ?? match.teamBId) : null,
        finishedAt: match.isBye ? new Date() : null,
      })
      .returning({ id: schema.matches.id });
    idByKey.set(`${match.round}:${match.slot}`, row.id);
    orderNo++;
  }

  for (const match of bracket.matches) {
    if (match.nextRound === null) continue;
    await tx
      .update(schema.matches)
      .set({
        nextMatchId: idByKey.get(`${match.nextRound}:${match.nextSlot}`)!,
        nextSlot: match.nextSide,
      })
      .where(eq(schema.matches.id, idByKey.get(`${match.round}:${match.slot}`)!));
  }

  for (const match of bracket.matches) {
    if (!match.isBye) continue;
    const winner = match.teamAId ?? match.teamBId;
    if (!winner || match.nextRound === null) continue;
    await tx
      .update(schema.matches)
      .set(match.nextSide === "a" ? { teamAId: winner } : { teamBId: winner })
      .where(eq(schema.matches.id, idByKey.get(`${match.nextRound}:${match.nextSlot}`)!));
  }

  /**
   * 3-oʻrin uchun oʻyin.
   *
   * Yarim finalda yutqazgan ikki jamoa oʻzaro oʻynaydi — musobaqada
   * bronza medal ham beriladi. Oʻyin final bilan bir bosqichda turadi
   * (`round` bir xil), `third_place` bayrogʻi bilan ajratiladi.
   *
   * Yarim finallarning `loser_match_id` si shu oʻyinga qaratiladi:
   * natija yozilishi bilan yutqazgan avtomatik tushadi — xuddi gʻolib
   * finalga tushgani kabi.
   */
  if (bracket.totalRounds >= 2) {
    const semiRound = bracket.totalRounds - 1;
    const semis = bracket.matches
      .filter((m) => m.round === semiRound)
      .sort((a, b) => a.slot - b.slot);

    if (semis.length === 2) {
      const [row] = await tx
        .insert(schema.matches)
        .values({
          categoryCode,
          stage,
          round: bracket.totalRounds,
          slot: 1, // final — 0, bronza — 1
          orderNo: orderNo++,
          thirdPlace: true,
          status: "pending",
        })
        .returning({ id: schema.matches.id });

      for (const [index, semi] of semis.entries()) {
        await tx
          .update(schema.matches)
          .set({ loserMatchId: row.id, loserSlot: index === 0 ? "a" : "b" })
          .where(eq(schema.matches.id, idByKey.get(`${semi.round}:${semi.slot}`)!));
      }
    }
  }

  return idByKey;
}

/**
 * Yutqazganni 3-oʻrin oʻyiniga koʻchiradi.
 *
 * `advanceWinner` bilan bir xil ish, faqat teskari tomon. Yarim
 * finaldan boshqa oʻyinlarda `loser_match_id` boʻsh — funksiya hech
 * narsa qilmaydi.
 */
export async function advanceLoser(
  tx: Tx,
  matchId: number,
  loserId: number | null,
): Promise<void> {
  const [match] = await tx
    .select({
      loserMatchId: schema.matches.loserMatchId,
      loserSlot: schema.matches.loserSlot,
    })
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId));

  if (!match?.loserMatchId || !match.loserSlot) return;

  await tx
    .update(schema.matches)
    .set(match.loserSlot === "a" ? { teamAId: loserId } : { teamBId: loserId })
    .where(eq(schema.matches.id, match.loserMatchId));
}

/**
 * Musobaqaning avtomatik davom etishi.
 *
 * Har bir natija yozilgandan keyin chaqiriladi va uchta ishni bajaradi:
 *
 *  1. Tayyor boʻlgan oʻyinlarga maydon biriktiradi. «Tayyor» = ikkala
 *     ishtirokchi maʼlum. Maydonsiz oʻyin hakam ekranida koʻrinmaydi —
 *     shuning uchun keyingi tur aynan shu qadamda «boshlanadi».
 *
 *  2. Robofutbolda guruh bosqichi tugagan boʻlsa pleyoffni oʻzi tuzadi.
 *
 *  3. Nima oʻzgargan boʻlsa — hodisa chiqaradi, hakam paneli va tablo
 *     oʻzi yangilanadi.
 *
 * Butun ish chaqiruvchining tranzaksiyasi ichida ketadi: natija yozilishi
 * va turning ochilishi bir vaqtda sodir boʻladi yoki umuman boʻlmaydi.
 */
export async function advanceCategory(
  tx: Tx,
  categoryCode: CategoryCode,
  actor: string,
): Promise<void> {
  const [settings] = await tx
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.code, categoryCode))
    .for("update");
  if (!settings) return;

  let structureChanged = false;

  // 1) Robofutbol: guruh bosqichi tugadimi → pleyoff
  if (CATEGORIES[categoryCode].format === "group_playoff") {
    const created = await maybeCreatePlayoff(tx, categoryCode, settings.fieldCount, actor);
    if (created) structureChanged = true;
  }

  // 2) Tayyor oʻyinlarga maydon
  const assigned = await assignFields(tx, categoryCode, settings.fieldCount);
  if (assigned > 0) structureChanged = true;

  if (structureChanged) {
    await emit(tx, categoryCode, "match.updated", {
      structure: true,
      reason: "stage.advanced",
    });
  }
}

/**
 * Gʻolibni keyingi bosqichga koʻchiradi.
 *
 * `next_match_id` va `next_slot` toʻrni tuzishda yozilgan, shuning uchun
 * bu yerda hech narsani qidirish shart emas — bitta UPDATE.
 */
export async function advanceWinner(
  tx: Tx,
  matchId: number,
  winnerId: number | null,
): Promise<void> {
  const [match] = await tx
    .select({
      nextMatchId: schema.matches.nextMatchId,
      nextSlot: schema.matches.nextSlot,
      teamAId: schema.matches.teamAId,
      teamBId: schema.matches.teamBId,
    })
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId));
  if (!match) return;

  if (match.nextMatchId && match.nextSlot) {
    await tx
      .update(schema.matches)
      .set(match.nextSlot === "a" ? { teamAId: winnerId } : { teamBId: winnerId })
      .where(eq(schema.matches.id, match.nextMatchId));
  }

  /*
    Yutqazgan 3-oʻrin oʻyiniga tushadi. Yutqazganni shu yerda oʻzimiz
    hisoblaymiz — chaqiruvchi joylarni oʻzgartirish shart emas va
    natija bekor qilinganda (winnerId = null) u ham qaytarib olinadi.
  */
  const loserId =
    winnerId === null
      ? null
      : winnerId === match.teamAId
        ? match.teamBId
        : winnerId === match.teamBId
          ? match.teamAId
          : null;

  await advanceLoser(tx, matchId, loserId);
}

/* ============================================================
   Maydon biriktirish
   ============================================================ */

/**
 * Ikkala ishtirokchisi maʼlum, hali maydonsiz va yakunlanmagan oʻyinlarga
 * maydon beradi. Yuk teng taqsimlanadi: har safar eng kam band maydon
 * tanlanadi, shuning uchun bitta maydonda navbat yigʻilib qolmaydi.
 */
export async function assignFields(
  tx: Tx,
  categoryCode: CategoryCode,
  fieldCount: number,
): Promise<number> {
  const fields = Math.max(1, fieldCount);

  // Guruhga maydon biriktirilgan boʻlsa — u ustunlik qiladi
  const groupFields = await tx
    .select({ id: schema.groups.id, fieldNo: schema.groups.fieldNo })
    .from(schema.groups)
    .where(eq(schema.groups.categoryCode, categoryCode));
  const fieldByGroup = new Map(
    groupFields.filter((g) => g.fieldNo !== null).map((g) => [g.id, g.fieldNo!]),
  );

  const ready = await tx
    .select({
      id: schema.matches.id,
      groupId: schema.matches.groupId,
      round: schema.matches.round,
      slot: schema.matches.slot,
    })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.categoryCode, categoryCode),
        ne(schema.matches.status, "done"),
        eq(schema.matches.isBye, false),
        isNull(schema.matches.fieldNo),
        sql`${schema.matches.teamAId} is not null`,
        sql`${schema.matches.teamBId} is not null`,
      ),
    )
    .orderBy(asc(schema.matches.round), asc(schema.matches.slot));

  if (ready.length === 0) return 0;

  // Maydonlardagi joriy navbat
  const load = new Map<number, number>();
  for (let f = 1; f <= fields; f++) load.set(f, 0);

  const existing = await tx
    .select({ fieldNo: schema.matches.fieldNo, count: sql<number>`count(*)::int` })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.categoryCode, categoryCode),
        ne(schema.matches.status, "done"),
        isNotNull(schema.matches.fieldNo),
      ),
    )
    .groupBy(schema.matches.fieldNo);

  for (const row of existing) {
    if (row.fieldNo !== null && row.fieldNo <= fields) {
      load.set(row.fieldNo, (load.get(row.fieldNo) ?? 0) + row.count);
    }
  }

  for (const match of ready) {
    const fromGroup = match.groupId ? fieldByGroup.get(match.groupId) : undefined;
    const field =
      fromGroup && fromGroup <= fields
        ? fromGroup
        : [...load.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];

    await tx
      .update(schema.matches)
      .set({ fieldNo: field })
      .where(eq(schema.matches.id, match.id));

    load.set(field, (load.get(field) ?? 0) + 1);
  }

  return ready.length;
}

/* ============================================================
   Pleyoff (guruhdan top-2)
   ============================================================ */

export async function maybeCreatePlayoff(
  tx: Tx,
  categoryCode: CategoryCode,
  fieldCount: number,
  actor: string,
): Promise<boolean> {
  const groupMatches = await tx
    .select({
      groupId: schema.matches.groupId,
      teamAId: schema.matches.teamAId,
      teamBId: schema.matches.teamBId,
      scoreA: schema.matches.scoreA,
      scoreB: schema.matches.scoreB,
      status: schema.matches.status,
    })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.categoryCode, categoryCode),
        eq(schema.matches.stage, "group"),
      ),
    );

  if (groupMatches.length === 0) return false;
  if (groupMatches.some((m) => m.status !== "done")) return false;

  const [already] = await tx
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.categoryCode, categoryCode),
        eq(schema.matches.stage, "playoff"),
      ),
    )
    .limit(1);
  if (already) return false;

  await createPlayoffBracket(tx, categoryCode, groupMatches, fieldCount, actor);
  return true;
}

type GroupMatchRow = {
  groupId: number | null;
  teamAId: number | null;
  teamBId: number | null;
  scoreA: number;
  scoreB: number;
  status: string;
};

export async function createPlayoffBracket(
  tx: Tx,
  categoryCode: CategoryCode,
  groupMatches: GroupMatchRow[],
  fieldCount: number,
  actor: string,
): Promise<{ qualified: number[]; totalRounds: number }> {
  const groupRows = await tx
    .select({
      groupId: schema.groups.id,
      groupName: schema.groups.name,
      teamId: schema.groupTeams.teamId,
      teamName: schema.teams.name,
      number: schema.teams.number,
    })
    .from(schema.groups)
    .innerJoin(schema.groupTeams, eq(schema.groupTeams.groupId, schema.groups.id))
    .innerJoin(schema.teams, eq(schema.teams.id, schema.groupTeams.teamId))
    .where(eq(schema.groups.categoryCode, categoryCode))
    .orderBy(asc(schema.groups.name));

  const byGroup = new Map<number, typeof groupRows>();
  for (const row of groupRows) {
    const list = byGroup.get(row.groupId) ?? [];
    list.push(row);
    byGroup.set(row.groupId, list);
  }

  const [settings] = await tx
    .select({ advancePerGroup: schema.categories.advancePerGroup })
    .from(schema.categories)
    .where(eq(schema.categories.code, categoryCode));
  const advancePerGroup = Math.max(1, settings?.advancePerGroup ?? 1);

  const qualified: number[] = [];
  /** Kim qaysi guruhdan chiqdi — toʻrda ularni 1-turda ajratish uchun */
  const groupOf = new Map<number, number>();

  for (const [groupId, rows] of byGroup) {
    const table = computeGroupTable(
      rows.map((r) => ({ id: r.teamId, name: r.teamName, number: r.number })),
      groupMatches.filter((m) => m.groupId === groupId),
    );
    for (const row of table.slice(0, advancePerGroup)) {
      qualified.push(row.teamId);
      groupOf.set(row.teamId, groupId);
    }
  }

  if (qualified.length < 2) {
    throw new Error("Pleyoff uchun jamoa yetarli emas");
  }

  const seed = createSeed();
  const bracket = buildBracket(qualified, seed, groupOf);
  await insertBracket(tx, categoryCode, "playoff", bracket, fieldCount);

  await tx.insert(schema.draws).values({
    categoryCode,
    seed,
    teamIds: qualified,
    resultJson: { format: "playoff", qualified, size: bracket.size, advancePerGroup },
    warnings: [],
    createdBy: actor,
  });

  await tx.insert(schema.auditLog).values({
    actor,
    action: "playoff.generate",
    entity: "category",
    entityId: categoryCode,
    after: { seed, qualified, auto: actor === "tizim" },
  });

  return { qualified, totalRounds: bracket.totalRounds };
}

/* ============================================================
   Texnik magʻlubiyat
   ============================================================ */

/**
 * Jamoa maydonga chiqmadi — raqib texnik gʻalaba oladi.
 *
 * Ilgari hakam soxta hisob yozishga majbur edi va statistikada yoʻq
 * gol qolib ketardi. Endi oʻyin alohida belgilanadi.
 *
 * Hisob 1:0 boʻlib qoladi — guruh jadvalida gʻolib 3 ochko olishi
 * kerak, 0:0 esa hech kimga hech narsa bermaydi. Ekranda raqam emas,
 * «texnik» deb koʻrsatiladi.
 *
 * Chaqiruvchi ruxsatni va tahrir mumkinligini OʻZI tekshiradi.
 */
export async function applyWalkover(
  tx: Tx,
  matchId: number,
  /** Qaysi tomon KELMADI */
  absentSide: "a" | "b",
  actor: string,
): Promise<{ winnerId: number | null; categoryCode: string }> {
  const [match] = await tx
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .for("update");
  if (!match) throw new Error("Oʻyin topilmadi");
  if (match.isBye) throw new Error("Raqibsiz oʻyinda texnik magʻlubiyat boʻlmaydi");

  const winnerId = absentSide === "a" ? match.teamBId : match.teamAId;
  if (!winnerId) throw new Error("Gʻolib jamoa aniqlanmagan");

  await tx
    .update(schema.matches)
    .set({
      scoreA: absentSide === "a" ? 0 : 1,
      scoreB: absentSide === "a" ? 1 : 0,
      winnerId,
      walkover: true,
      status: "done",
      finishedAt: new Date(),
    })
    .where(eq(schema.matches.id, matchId));

  if (match.stage === "playoff") await advanceWinner(tx, matchId, winnerId);

  await tx.insert(schema.auditLog).values({
    actor,
    action: "match.walkover",
    entity: "match",
    entityId: String(matchId),
    before: { scoreA: match.scoreA, scoreB: match.scoreB, status: match.status },
    after: { absentSide, winnerId },
  });

  await emit(tx, match.categoryCode, "match.updated", {
    matchId,
    scoreA: absentSide === "a" ? 0 : 1,
    scoreB: absentSide === "a" ? 1 : 0,
    winnerId,
    status: "done",
    walkover: true,
  });

  return { winnerId, categoryCode: match.categoryCode };
}
