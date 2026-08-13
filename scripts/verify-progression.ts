/**
 * Musobaqa kunini boshdan-oxir simulyatsiya qiladi:
 *   npx tsx --env-file=.env.local scripts/verify-progression.ts
 *
 * Bu sinov HAQIQIY production kodini chaqiradi (`server/lib/progression.ts`),
 * nusxasini emas. Tekshiriladigan asosiy vaʼda:
 *
 *   «Tur tugashi bilan keyingi tur avtomatik boshlanadi»
 *
 * Yaʼni: oxirgi natija yozilgach keyingi bosqich oʻyinlarida ikkala
 * ishtirokchi ham, maydon raqami ham boʻlishi shart. Maydonsiz oʻyin
 * hakam ekranida koʻrinmaydi — demak tur boshlanmagan hisoblanadi.
 *
 * Skript oʻz maʼlumotini yaratadi va oxirida tozalaydi.
 */
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "../lib/db";
import {
  advanceCategory,
  advanceWinner,
  assignFields,
  insertBracket,
} from "../server/lib/progression";
import { buildBracket, roundRobin } from "../lib/draw/engine";
import { createSeed } from "../lib/draw/rng";
import { computeGroupTable } from "../lib/standings";
import { CATEGORIES, type CategoryCode } from "../lib/categories";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "XATO"} ${label}${!ok && detail ? " — " + detail : ""}`);
}

async function checkedInTeams(code: CategoryCode) {
  return db
    .select({ id: schema.teams.id, name: schema.teams.name, number: schema.teams.number })
    .from(schema.teams)
    .where(and(eq(schema.teams.categoryCode, code), isNotNull(schema.teams.checkedInAt)))
    .orderBy(asc(schema.teams.numberSeq));
}

async function loadMatches(code: CategoryCode) {
  return db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.categoryCode, code))
    .orderBy(asc(schema.matches.round), asc(schema.matches.slot));
}

async function cleanup(code: CategoryCode) {
  await db.delete(schema.matches).where(eq(schema.matches.categoryCode, code));
  await db.delete(schema.groups).where(eq(schema.groups.categoryCode, code));
  await db.delete(schema.draws).where(eq(schema.draws.categoryCode, code));
  await db.delete(schema.events).where(ne(schema.events.channel, "__keep"));
  await db
    .update(schema.categories)
    .set({ drawLocked: false })
    .where(eq(schema.categories.code, code));
}

/* ============================================================
   1. Olib tashlash toʻri: har tur tugagach keyingisi ochiladi
   ============================================================ */
async function testSingleElim() {
  const code: CategoryCode = "S";
  console.log("\nSumo — olib tashlash toʻri");
  await cleanup(code);

  const teams = await checkedInTeams(code);
  const fieldCount = 2;
  await db
    .update(schema.categories)
    .set({ fieldCount })
    .where(eq(schema.categories.code, code));

  await db.transaction(async (tx) => {
    const bracket = buildBracket(
      teams.map((t) => t.id),
      createSeed(),
    );
    await insertBracket(tx, code, "playoff", bracket, fieldCount);
    await assignFields(tx, code, fieldCount);
  });

  let matches = await loadMatches(code);
  const totalRounds = Math.max(...matches.map((m) => m.round));
  check(`${teams.length} jamoa → ${totalRounds} bosqich tuzildi`, totalRounds > 1);

  const round1Ready = matches.filter(
    (m) => m.round === 1 && !m.isBye && m.teamAId && m.teamBId,
  );
  check(
    "1-turdagi hamma oʻyinga maydon berilgan",
    round1Ready.every((m) => m.fieldNo !== null),
    `${round1Ready.filter((m) => m.fieldNo === null).length} ta maydonsiz`,
  );
  check(
    `maydonlar 1..${fieldCount} oraligʻida`,
    round1Ready.every((m) => m.fieldNo! >= 1 && m.fieldNo! <= fieldCount),
  );

  // Turma-tur oʻynaymiz
  for (let round = 1; round <= totalRounds; round++) {
    const playable = (await loadMatches(code)).filter(
      (m) => m.round === round && m.status !== "done" && m.teamAId && m.teamBId,
    );

    for (const match of playable) {
      await db.transaction(async (tx) => {
        // Hakam «A yutdi» deb bosgandagi bilan bir xil yozuv
        await tx
          .update(schema.matches)
          .set({
            scoreA: 2,
            scoreB: 0,
            winnerId: match.teamAId,
            status: "done",
            finishedAt: new Date(),
          })
          .where(eq(schema.matches.id, match.id));
        await advanceWinner(tx, match.id, match.teamAId);
        await advanceCategory(tx, code, "sinov");
      });
    }

    if (round < totalRounds) {
      const next = (await loadMatches(code)).filter(
        (m) => m.round === round + 1 && !m.isBye,
      );
      check(
        `${round}-tur tugadi → ${round + 1}-turda ikkala ishtirokchi maʼlum`,
        next.every((m) => m.teamAId !== null && m.teamBId !== null),
        `${next.filter((m) => !m.teamAId || !m.teamBId).length} ta toʻliqmas`,
      );
      check(
        `${round + 1}-turga maydon avtomatik berildi`,
        next.every((m) => m.fieldNo !== null),
        `${next.filter((m) => m.fieldNo === null).length} ta maydonsiz`,
      );
    }
  }

  matches = await loadMatches(code);
  const final = matches.filter((m) => m.round === totalRounds);
  check("final yakunlandi va gʻolib bor", final.length === 1 && final[0].winnerId !== null);
  check(
    "yakunlanmagan oʻyin qolmadi",
    matches.every((m) => m.status === "done"),
    `${matches.filter((m) => m.status !== "done").length} ta qoldi`,
  );

  await cleanup(code);
}

/* ============================================================
   2. Guruh → pleyoff avtomatik tuzilishi
   ============================================================ */
async function testGroupToPlayoff() {
  const code: CategoryCode = "R";
  console.log("\nRobofutbol — guruh bosqichi → avtomatik pleyoff");
  await cleanup(code);

  const teams = await checkedInTeams(code);
  const groupSize = 4;
  const fieldCount = 3;
  await db
    .update(schema.categories)
    .set({ fieldCount, groupSize })
    .where(eq(schema.categories.code, code));

  // Guruhlar va round-robin
  const groupCount = Math.ceil(teams.length / groupSize);
  const buckets: number[][] = Array.from({ length: groupCount }, () => []);
  teams.forEach((team, i) => buckets[i % groupCount].push(team.id));

  await db.transaction(async (tx) => {
    for (const [index, bucket] of buckets.entries()) {
      const [group] = await tx
        .insert(schema.groups)
        .values({ categoryCode: code, name: String.fromCharCode(65 + index) })
        .returning({ id: schema.groups.id });

      for (const [position, teamId] of bucket.entries()) {
        await tx.insert(schema.groupTeams).values({ groupId: group.id, teamId, position });
      }
      for (const pair of roundRobin(bucket)) {
        await tx.insert(schema.matches).values({
          categoryCode: code,
          stage: "group",
          groupId: group.id,
          round: pair.round,
          slot: 0,
          teamAId: pair.a,
          teamBId: pair.b,
        });
      }
    }
    await assignFields(tx, code, fieldCount);
  });

  const groupMatches = (await loadMatches(code)).filter((m) => m.stage === "group");
  check(`${groupCount} guruh · ${groupMatches.length} guruh oʻyini`, groupMatches.length > 0);
  check(
    "guruh oʻyinlariga maydon berilgan",
    groupMatches.every((m) => m.fieldNo !== null),
  );
  check(
    "maydon yuki teng taqsimlangan",
    isBalanced(groupMatches.map((m) => m.fieldNo!), fieldCount),
    "bir maydonda navbat yigʻilib qolgan",
  );

  // Hamma guruh oʻyinini oʻynaymiz — har xil hisob bilan
  let index = 0;
  for (const match of groupMatches) {
    const scoreA = index % 3;
    const scoreB = (index + 1) % 3;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.matches)
        .set({
          scoreA,
          scoreB,
          winnerId: scoreA > scoreB ? match.teamAId : scoreB > scoreA ? match.teamBId : null,
          status: "done",
          finishedAt: new Date(),
        })
        .where(eq(schema.matches.id, match.id));
      await advanceCategory(tx, code, "sinov");
    });
    index++;
  }

  const after = await loadMatches(code);
  const playoff = after.filter((m) => m.stage === "playoff");

  check(
    "guruh bosqichi tugagach pleyoff OʻZI tuzildi",
    playoff.length > 0,
    "pleyoff yaratilmadi",
  );
  check(
    `har guruhdan 2 tadan → ${groupCount * 2} jamoa`,
    new Set(
      playoff
        .filter((m) => m.round === 1)
        .flatMap((m) => [m.teamAId, m.teamBId])
        .filter(Boolean),
    ).size === groupCount * 2,
  );

  const playoffReady = playoff.filter(
    (m) => m.round === 1 && !m.isBye && m.teamAId && m.teamBId,
  );
  check(
    "pleyoff 1-turiga maydon berilgan",
    playoffReady.length > 0 && playoffReady.every((m) => m.fieldNo !== null),
  );

  // Top-2 tanlovi jadval bilan mos kelishini tekshiramiz
  const groups = await db
    .select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.groups)
    .where(eq(schema.groups.categoryCode, code));
  const memberships = await db
    .select({ groupId: schema.groupTeams.groupId, teamId: schema.groupTeams.teamId })
    .from(schema.groupTeams);

  const qualifiedSet = new Set(
    playoff
      .filter((m) => m.round === 1)
      .flatMap((m) => [m.teamAId, m.teamBId])
      .filter((x): x is number => x !== null),
  );

  let tableMatch = true;
  for (const group of groups) {
    const ids = memberships.filter((m) => m.groupId === group.id).map((m) => m.teamId);
    const table = computeGroupTable(
      teams.filter((t) => ids.includes(t.id)),
      after.filter((m) => m.groupId === group.id),
    );
    for (const row of table.slice(0, 2)) {
      if (!qualifiedSet.has(row.teamId)) tableMatch = false;
    }
  }
  check("pleyoffga chiqqanlar jadvaldagi top-2 bilan mos", tableMatch);

  await cleanup(code);
}

/* ============================================================
   3. Maydon sonini oʻzgartirish
   ============================================================ */
async function testFieldChange() {
  const code: CategoryCode = "RR";
  console.log("\nRobrace — maydon sonini musobaqa davomida oʻzgartirish");
  await cleanup(code);

  const teams = await checkedInTeams(code);
  await db.transaction(async (tx) => {
    const bracket = buildBracket(
      teams.map((t) => t.id),
      createSeed(),
    );
    await insertBracket(tx, code, "playoff", bracket, 1);
    await assignFields(tx, code, 1);
  });

  const before = (await loadMatches(code)).filter((m) => !m.isBye && m.teamAId && m.teamBId);
  check("1 maydonda hammasi 1-maydonda", before.every((m) => m.fieldNo === 1));

  // 3 maydonga oshiramiz (sozlamalar action'i shuni qiladi)
  await db.transaction(async (tx) => {
    await tx
      .update(schema.matches)
      .set({ fieldNo: null })
      .where(
        and(
          eq(schema.matches.categoryCode, code),
          eq(schema.matches.status, "pending"),
          eq(schema.matches.isBye, false),
        ),
      );
    await assignFields(tx, code, 3);
  });

  const after = (await loadMatches(code)).filter(
    (m) => m.status === "pending" && !m.isBye && m.teamAId && m.teamBId,
  );
  const used = new Set(after.map((m) => m.fieldNo));
  check(
    "3 maydonga qayta taqsimlandi",
    after.every((m) => m.fieldNo !== null && m.fieldNo <= 3),
  );
  check(
    "bir nechta maydon ishlatildi",
    used.size > 1 || after.length <= 1,
    `faqat ${used.size} ta maydon`,
  );

  await cleanup(code);
}

function isBalanced(fields: number[], fieldCount: number): boolean {
  const counts = new Map<number, number>();
  for (let f = 1; f <= fieldCount; f++) counts.set(f, 0);
  for (const f of fields) counts.set(f, (counts.get(f) ?? 0) + 1);
  const values = [...counts.values()];
  return Math.max(...values) - Math.min(...values) <= 1;
}

async function main() {
  await testSingleElim();
  await testGroupToPlayoff();
  await testFieldChange();

  console.log(failed === 0 ? "\nHammasi joyida.\n" : `\n${failed} ta xato bor.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nSinov xatosi:", err);
  process.exit(1);
});
