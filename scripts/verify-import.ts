/**
 * Excel moslash mantiqini tekshiradi: npx tsx scripts/verify-import.ts
 * Bazasiz ishlaydi.
 *
 * Bu qismda xato boʻlsa 400 ta jamoa notoʻgʻri yoʻnalishga tushadi va
 * buni faqat jerebyovkadan keyin sezish mumkin — shuning uchun alohida
 * sinov.
 */
import {
  prepareRows,
  resolveCategory,
  suggestMapping,
  dropEmptyRows,
  type ImportRow,
} from "../lib/import-mapping";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "XATO"} ${label}${!ok && detail ? " — " + detail : ""}`);
}

/* ---------------- Yo'nalishni tanish ---------------- */
console.log("\nYoʻnalishni tanish");
const CASES: [string, string | null][] = [
  ["Robofutbol", "F"],
  ["robofutbol", "F"],
  ["ROBO FUTBOL", "F"],
  ["futbol", "F"],
  ["F", "F"],
  ["Arduino Robosumo", "S"],
  ["Lego Robosumo", "LS"],
  ["S", "S"],
  ["Linefollower", "LF"],
  ["line follower", "LF"],
  ["chiziq", "LF"],
  ["Roborace", "RC"],
  ["poyga", "RC"],
  ["RC", "RC"],
  ["", null],
  ["shaxmat", null],
];
for (const [input, expected] of CASES) {
  const got = resolveCategory(input);
  check(`«${input || "(boʻsh)"}» → ${expected ?? "aniqlanmadi"}`, got === expected, String(got));
}

/* ---------------- Sarlavhalarni taxmin qilish ---------------- */
console.log("\nUstunlarni avtomatik taxmin qilish");
{
  const headers = [
    "№",
    "Yoʻnalish",
    "Jamoa nomi",
    "Ishtirokchi 1",
    "Ishtirokchi 2",
    "Maktab",
    "Murabbiy",
    "Telefon raqami",
    "Viloyat",
  ];
  const m = suggestMapping(headers);
  check("yoʻnalish topildi", m.categoryCode === 1, String(m.categoryCode));
  check("jamoa nomi topildi", m.name === 2, String(m.name));
  check("ikkala ishtirokchi ustuni topildi", m.members.join(",") === "3,4", m.members.join(","));
  check("maktab topildi", m.school === 5, String(m.school));
  check("murabbiy topildi", m.coach === 6, String(m.coach));
  check("telefon topildi", m.phone === 7, String(m.phone));
  check("viloyat topildi", m.region === 8, String(m.region));
}
{
  // Ruscha/inglizcha sarlavhalar ham tanilsin
  const m = suggestMapping(["Category", "Team", "Members", "School", "Phone"]);
  check("inglizcha: category", m.categoryCode === 0, String(m.categoryCode));
  check("inglizcha: team", m.name === 1, String(m.name));
  check("inglizcha: members", m.members.join(",") === "2", m.members.join(","));
}

/* ---------------- Qatorlarni tayyorlash ---------------- */
console.log("\nQatorlarni tayyorlash");
{
  const headers = ["Yoʻnalish", "Jamoa", "Ishtirokchilar", "Maktab"];
  const mapping = suggestMapping(headers);
  const rows: ImportRow[] = [
    ["Robofutbol", "Chaqmoq", "Ali Valiyev, Vali Aliyev", "110-maktab"],
    ["sumo", "", "Malika Rasulova", "Prezident maktabi"],
    ["Linefollower", "Yulduz", "", ""],
    ["shaxmat", "Notoʻgʻri", "Kimdir", ""],
    ["", "", "", ""],
  ];

  const prepared = prepareRows(rows, mapping);

  check("1-qator: yoʻnalish F", prepared[0].categoryCode === "F");
  check("1-qator: 2 ishtirokchi ajratildi", prepared[0].members.length === 2, String(prepared[0].members.length));
  check("1-qator: muammo yoʻq", prepared[0].problem === null, prepared[0].problem ?? "");

  check("2-qator: nom boʻsh → ishtirokchi ismi olindi", prepared[1].name === "Malika Rasulova", prepared[1].name);
  check("2-qator: muammo yoʻq", prepared[1].problem === null, prepared[1].problem ?? "");

  check("3-qator: ishtirokchisiz ham nom bor", prepared[2].name === "Yulduz");
  check("3-qator: muammo yoʻq", prepared[2].problem === null, prepared[2].problem ?? "");

  check("4-qator: notanish yoʻnalish belgilandi", prepared[3].problem !== null, "muammo aniqlanmadi");
  check("5-qator: butunlay boʻsh → muammo", prepared[4].problem !== null);

  // Qator raqami sarlavhani hisobga oladi (Excel'dagi haqiqiy raqam)
  check("qator raqami 2 dan boshlanadi", prepared[0].rowNumber === 2, String(prepared[0].rowNumber));
}

/* ---------------- Ishtirokchilarni ajratish ---------------- */
console.log("\nIshtirokchilarni ajratish");
{
  const mapping = suggestMapping(["Yoʻnalish", "Ishtirokchilar"]);
  const rows: ImportRow[] = [
    ["S", "Ali Valiyev; Vali Aliyev"],
    ["S", "Ali Valiyev\nVali Aliyev"],
    ["S", "Ali Valiyev / Vali Aliyev"],
    ["S", "Ali Valiyev, Ali Valiyev"], // takror
  ];
  const prepared = prepareRows(rows, mapping);
  check("nuqta-vergul bilan", prepared[0].members.length === 2, String(prepared[0].members.length));
  check("yangi qator bilan", prepared[1].members.length === 2, String(prepared[1].members.length));
  check("qiya chiziq bilan", prepared[2].members.length === 2, String(prepared[2].members.length));
  check("takror ism bir marta olinadi", prepared[3].members.length === 1, String(prepared[3].members.length));
}

/* ---------------- Bo'sh qatorlar ---------------- */
console.log("\nBoʻsh qatorlar");
{
  const rows: ImportRow[] = [["a", "b"], ["", ""], ["  ", ""], ["c", ""]];
  check("boʻsh qatorlar tashlandi", dropEmptyRows(rows).length === 2, String(dropEmptyRows(rows).length));
}

console.log(failed === 0 ? "\nHammasi joyida.\n" : `\n${failed} ta xato bor.\n`);
process.exit(failed === 0 ? 0 : 1);
