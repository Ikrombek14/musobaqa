/**
 * Tablo tekshiruvi — bloklar bir-birining ustiga chiqmasligi.
 *
 *   node scripts/check-tablo.mjs [manzil]
 *
 * Nima tekshiriladi:
 *   1. Aka-uka elementlar kesishmaydi (overlap).
 *   2. Hech bir element `#stage` chegarasidan chiqmaydi.
 *   3. Matn kesilmaydi: `scrollWidth <= clientWidth + 1`.
 *   4. Robofutbol paneli guruh almashganda BALANDLIGINI oʻzgartirmaydi.
 *   5. Konsolda JS xatosi yoʻq.
 *
 * Uch oʻlchamda: 1920×1080 (proyektor), 2560×1440, 1366×768 (noutbuk).
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const SIZES = [
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
  { w: 1366, h: 768 },
];
const OUT = "test-results";

let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "XATO"} ${label}${!ok && detail ? " — " + detail : ""}`);
};

/** Ikki toʻrtburchak kesishadimi (1px bagʻrikenglik bilan) */
const overlaps = (a, b) =>
  a.left < b.right - 1 &&
  b.left < a.right - 1 &&
  a.top < b.bottom - 1 &&
  b.top < a.bottom - 1;

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

for (const size of SIZES) {
  console.log(`\n${size.w}×${size.h}`);
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });

  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/tablo`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/tablo-${size.w}x${size.h}.png` });

  /* ---- 1. Aka-uka elementlar kesishmasin ---- */
  const overlapPairs = await page.evaluate(() => {
    const groups = [
      ".tablo-stage > *",
      ".tb-live-row > *",
      ".tb-disc-row > *",
      ".tb-disc .tb-row",
      ".tb-q-item",
    ];
    const bad = [];
    for (const selector of groups) {
      const nodes = [...document.querySelectorAll(selector)].filter(
        (n) => n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== "hidden",
      );
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i].getBoundingClientRect();
          const b = nodes[j].getBoundingClientRect();
          if (
            a.left < b.right - 1 &&
            b.left < a.right - 1 &&
            a.top < b.bottom - 1 &&
            b.top < a.bottom - 1
          ) {
            bad.push(`${selector} [${i}]×[${j}]`);
          }
        }
      }
    }
    return bad;
  });
  check(overlapPairs.length === 0, "bloklar ustma-ust tushmaydi", overlapPairs.join(", "));

  /* ---- 2. Kanvasdan tashqariga chiqmasin ---- */
  const outside = await page.evaluate(() => {
    const stage = document.querySelector(".tablo-stage").getBoundingClientRect();
    const bad = [];
    for (const el of document.querySelectorAll(
      ".tb-match, .tb-queue, .tb-disc, .tb-ticker, .tb-d-next",
    )) {
      const r = el.getBoundingClientRect();
      if (
        r.left < stage.left - 1 ||
        r.right > stage.right + 1 ||
        r.top < stage.top - 1 ||
        r.bottom > stage.bottom + 1
      ) {
        bad.push(el.className);
      }
    }
    return bad;
  });
  check(outside.length === 0, "hech narsa kanvasdan chiqmaydi", outside.join(", "));

  /* ---- 3. Matn kesilmasin ---- */
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll(".tb-disc, .tb-match, .tb-queue, .tb-ticker, .tb-row")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.className)
      .slice(0, 5),
  );
  check(overflowing.length === 0, "gorizontal toshish yoʻq", overflowing.join(", "));

  /* ---- 4. Aylanishda panel balandligi oʻzgarmasin ---- */
  const before = await page.evaluate(() => {
    const p = document.querySelector(".tb-disc");
    return {
      h: Math.round(p.getBoundingClientRect().height),
      name: p.querySelector(".tb-pager-name")?.textContent ?? "",
    };
  });
  await page.waitForTimeout(10_000);
  const after = await page.evaluate(() => {
    const p = document.querySelector(".tb-disc");
    return {
      h: Math.round(p.getBoundingClientRect().height),
      name: p.querySelector(".tb-pager-name")?.textContent ?? "",
    };
  });
  await page.screenshot({ path: `${OUT}/tablo-${size.w}x${size.h}-keyin.png` });
  check(before.h === after.h, "aylanishda panel balandligi oʻzgarmaydi", `${before.h}→${after.h}`);
  if (before.name && after.name) {
    check(true, `sahifa: «${before.name}» → «${after.name}»`);
  }

  /* ---- 5. Konsol toza ---- */
  check(errors.length === 0, "JS xatosi yoʻq", errors.slice(0, 2).join(" | "));

  await page.close();
}

await browser.close();
console.log(failed === 0 ? "\nHammasi joyida.\n" : `\n${failed} ta xato.\n`);
process.exit(failed === 0 ? 0 : 1);
