/**
 * Jerebyovka dvigatelini tekshirish: npx tsx scripts/verify-draw.ts
 * Bazasiz ishlaydi. Musobaqa kunidan oldin har o'zgarishdan keyin ishlatilsin.
 */
import {
  buildBracket,
  drawGroups,
  roundName,
  roundRobin,
  type DrawTeam,
} from "../lib/draw/engine";
import { createSeed } from "../lib/draw/rng";

let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  XATO ${label}${detail ? " — " + detail : ""}`);
  }
}

/* ---------------- To'r ---------------- */
console.log("\nOlib tashlash to'ri");
for (const n of [2, 3, 4, 5, 7, 8, 9, 16, 17, 31, 64, 100]) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const seed = createSeed();
  const { matches, totalRounds, size, byes } = buildBracket(ids, seed);

  const first = matches.filter((m) => m.round === 1);
  const placed = first.flatMap((m) => [m.teamAId, m.teamBId]).filter((x) => x !== null);
  const unique = new Set(placed);

  const finals = matches.filter((m) => m.round === totalRounds);
  const wiringOk = matches.every((m) => {
    if (m.round === totalRounds) return m.nextRound === null;
    const target = matches.find((x) => x.round === m.nextRound && x.slot === m.nextSlot);
    return target !== undefined;
  });

  check(
    `n=${n}: hamma jamoa to'rda (${unique.size}/${n})`,
    unique.size === n,
    `takror yoki tushib qolgan`,
  );
  check(`n=${n}: bitta final`, finals.length === 1, `${finals.length} ta`);
  check(`n=${n}: simlar butun`, wiringOk);
  check(`n=${n}: bay soni = ${byes} (size ${size})`, byes === size - n);

  // Deterministiklik: bir xil seed → bir xil natija
  const again = buildBracket(ids, seed);
  check(
    `n=${n}: seed takrorlanadi`,
    JSON.stringify(again.matches) === JSON.stringify(matches),
  );
}

/* ---------------- Guruhlar ---------------- */
console.log("\nGuruh jerebyovkasi");
{
  // 40 jamoa, 10 maktab, har maktabdan 4 ta
  const teams: DrawTeam[] = [];
  for (let s = 1; s <= 10; s++) {
    for (let t = 1; t <= 4; t++) {
      teams.push({ id: teams.length + 1, name: `Jamoa ${teams.length + 1}`, school: `Maktab ${s}` });
    }
  }
  const seed = createSeed();
  const { groups, warnings } = drawGroups(teams, 4, seed);
  const all = groups.flatMap((g) => g.teamIds);

  check(`40 jamoa taqsimlandi`, new Set(all).size === 40, `${new Set(all).size} ta`);
  check(`10 guruh hosil bo'ldi`, groups.length === 10, `${groups.length} ta`);
  check(`guruhlar 4 tadan`, groups.every((g) => g.teamIds.length === 4));

  const clash = groups.some((g) => {
    const schools = g.teamIds.map((id) => teams.find((t) => t.id === id)!.school);
    return new Set(schools).size !== schools.length;
  });
  check(`bir maktabdan ikki jamoa bitta guruhda emas`, !clash);
  check(`ogohlantirish yo'q`, warnings.length === 0, warnings.join("; "));

  const again = drawGroups(teams, 4, seed);
  check(`seed takrorlanadi`, JSON.stringify(again.groups) === JSON.stringify(groups));
}
{
  // Imkonsiz holat: bitta maktabdan 5 jamoa, guruh 4 talik, jami 8 jamoa
  const teams: DrawTeam[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `A${i}`, school: "Bitta maktab" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: i + 6, name: `B${i}`, school: `Boshqa ${i}` })),
  ];
  const { groups, warnings } = drawGroups(teams, 4, createSeed());
  const all = groups.flatMap((g) => g.teamIds);
  check(`imkonsiz holatda ham hamma joylashdi`, new Set(all).size === 8);
  check(`ogohlantirish chiqdi`, warnings.length > 0, "ogohlantirish yo'q");
}

/* ---------------- Round-robin ---------------- */
console.log("\nRound-robin");
for (const n of [2, 3, 4, 5, 6]) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const pairs = roundRobin(ids);
  const expected = (n * (n - 1)) / 2;
  const seen = new Set(pairs.map((p) => [p.a, p.b].sort((x, y) => x - y).join("-")));
  check(`n=${n}: ${expected} ta o'yin`, pairs.length === expected, `${pairs.length} ta`);
  check(`n=${n}: takrorlanmaydi`, seen.size === expected);

  // Bir jamoa bitta turda ikki marta o'ynamasin
  const byRound = new Map<number, number[]>();
  for (const p of pairs) {
    const list = byRound.get(p.round) ?? [];
    list.push(p.a, p.b);
    byRound.set(p.round, list);
  }
  const clash = [...byRound.values()].some((l) => new Set(l).size !== l.length);
  check(`n=${n}: tur ichida to'qnashuv yo'q`, !clash);
}

/* ---------------- Bosqich nomlari ---------------- */
console.log("\nBosqich nomlari");
{
  // 16 talik toʻr: 4 bosqich. Birinchi tur 8 ta uchrashuv = «1/8 final».
  const expected16 = ["1/8 final", "Chorak final", "Yarim final", "Final"];
  for (const [index, name] of expected16.entries()) {
    check(`16 talik toʻr, ${index + 1}-tur → «${name}»`, roundName(index + 1, 4) === name, roundName(index + 1, 4));
  }

  // 8 talik toʻr: 3 bosqich
  const expected8 = ["Chorak final", "Yarim final", "Final"];
  for (const [index, name] of expected8.entries()) {
    check(`8 talik toʻr, ${index + 1}-tur → «${name}»`, roundName(index + 1, 3) === name, roundName(index + 1, 3));
  }

  check("2 talik toʻr → «Final»", roundName(1, 1) === "Final", roundName(1, 1));
  check(
    "64 talik toʻr, 1-tur → «1/32 final»",
    roundName(1, 6) === "1/32 final",
    roundName(1, 6),
  );
}

console.log(failed === 0 ? "\nHammasi joyida.\n" : `\n${failed} ta xato bor.\n`);
process.exit(failed === 0 ? 0 : 1);
