import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAdmin, loginJudge, PINS, resetDatabase, watchForErrors } from "./helpers";

test.beforeAll(() => resetDatabase());

/**
 * Yoʻnalishga BITTA maydon qoʻyib jerebyovka oʻtkazamiz.
 *
 * Bitta maydon ataylab: shunda yoʻnalishning hamma oʻyini bitta hakamga
 * tushadi va «tur tugadi → keyingisi oʻzi ochildi» zanjirini bitta
 * brauzerda kuzatish mumkin.
 */
async function setupCategory(
  page: Page,
  categoryName: string,
  fieldsSliderId: string,
  options: { groupSize?: number } = {},
) {
  await loginAdmin(page);
  await page.goto("/admin/sozlamalar");

  const card = page.getByRole("region", { name: categoryName });
  await card.locator(`#${fieldsSliderId}`).fill("1");
  if (options.groupSize) await card.locator("#gsize-R").fill(String(options.groupSize));
  await card.getByRole("button", { name: "Saqlash", exact: true }).click();
  await expect(card.getByText(/Saqlandi/)).toBeVisible();

  await page.goto("/admin/draw");
  const drawCard = page.getByRole("region", { name: categoryName });
  await drawCard.getByRole("button", { name: "Jerebyovka oʻtkazish" }).click();
  await drawCard.getByRole("button", { name: "Ha, oʻtkazilsin" }).click();
  await expect(drawCard.getByText(/seed:/)).toBeVisible();
}

/** Hali yakunlanmagan (bekor qilish oynasi yoʻq) birinchi kartochka. */
function nextMatchCard(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /Navbatdagi oʻyinlar/ }) })
    .locator("> div")
    .filter({ hasNot: page.getByRole("button", { name: /Bekor qilish/ }) })
    .first();
}

async function pendingCount(page: Page): Promise<number> {
  const label =
    (await page.getByRole("heading", { name: /Navbatdagi oʻyinlar/ }).textContent()) ?? "";
  return Number(label.match(/(\d+)/)?.[1] ?? "0");
}

async function expand(card: Locator) {
  const header = card.getByRole("button").first();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
}

test.describe("Hakam — kirish", () => {
  test("notoʻgʻri PIN rad etiladi, toʻgʻrisi kiritadi", async ({ page }) => {
    await page.goto("/hakam");
    await page.getByLabel("PIN kod").fill("9999");
    await page.getByRole("button", { name: "Kirish" }).click();
    await expect(page.getByText("PIN notoʻgʻri")).toBeVisible();

    await page.getByLabel("PIN kod").fill(PINS.S1);
    await page.getByRole("button", { name: "Kirish" }).click();
    await expect(page.getByRole("button", { name: "Chiqish" })).toBeVisible();
    await expect(page.getByText("Sumo", { exact: true })).toBeVisible();
  });

  test("hakam faqat oʻz maydonini koʻradi", async ({ page }) => {
    await loginJudge(page, PINS.S1);
    await expect(page.getByText("Oʻyinlar · 1-maydon")).toBeVisible();
  });
});

test.describe("Hakam — sumo (best of 3)", () => {
  test("2-gʻalabada oʻzi yopiladi va «Bekor qilish» koʻrinadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await setupCategory(page, "Sumo", "fields-S");
    await loginJudge(page, PINS.S1);

    const card = nextMatchCard(page);
    await expand(card);

    const winButtons = card.getByRole("button", { name: /raundni yutdi/ });
    await winButtons.first().click();
    await expect(card.getByText("Ketmoqda")).toBeVisible();

    await winButtons.first().click();
    await expect(page.getByText(/Uchrashuv yakunlandi: 2:0/)).toBeVisible();

    // TZ talabi: 10 soniya davomida bekor qilish imkoni
    await expect(page.getByRole("button", { name: /Bekor qilish/ })).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("bekor qilish natijani qaytaradi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginJudge(page, PINS.S1);

    const before = await pendingCount(page);
    const card = nextMatchCard(page);
    await expand(card);

    const winButtons = card.getByRole("button", { name: /raundni yutdi/ });
    await winButtons.first().click();
    await winButtons.first().click();
    await expect(page.getByText(/Uchrashuv yakunlandi/)).toBeVisible();
    expect(await pendingCount(page)).toBe(before - 1);

    await page.getByRole("button", { name: /Bekor qilish/ }).click();
    await expect(page.getByText(/Uchrashuv yakunlandi/)).toBeHidden();
    expect(await pendingCount(page)).toBe(before);

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("butun toʻr oxirigacha: har tur OʻZI ochiladi", async ({ page }) => {
    test.setTimeout(180_000);
    const { errors } = watchForErrors(page);
    await loginJudge(page, PINS.S1);

    let played = 0;
    for (let i = 0; i < 40; i++) {
      const before = await pendingCount(page);
      if (before === 0) break;

      const card = nextMatchCard(page);
      await expand(card);

      const winButtons = card.getByRole("button", { name: /raundni yutdi/ });
      if ((await winButtons.count()) < 2) {
        // Ishtirokchisi hali koʻchmagan — SSE yangilanishini kutamiz
        await page.waitForTimeout(600);
        continue;
      }
      await winButtons.first().click();
      await winButtons.first().click();

      // Natija yozildi = navbat qisqardi. Tugagan tur oʻrniga keyingi tur
      // ochilsa sanoq oshib ketishi mumkin — shuning uchun «kamaydi» emas,
      // «oʻzgardi» deb tekshiramiz.
      await expect
        .poll(() => pendingCount(page), { timeout: 15_000 })
        .not.toBe(before);
      played++;
    }

    expect(played, "uchrashuvlar oʻynaldi").toBeGreaterThan(5);
    await expect(page.getByText("Hammasi yakunlandi")).toBeVisible({ timeout: 30_000 });

    // Gʻolib jonli tabloda. Bosqich nomlari ham toʻgʻri boʻlsin:
    // 16 talik toʻrda birinchi tur «1/8 final», «1/16 final» EMAS.
    await page.goto("/jonli/sumo");
    await expect(page.getByRole("heading", { name: "Final", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "1/16 final" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "1/8 final" })).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});

test.describe("Hakam — robofutbol: guruh tugadi → pleyoff OʻZI tuziladi", () => {
  test("hamma guruh oʻyini oʻynalgach pleyoff paydo boʻladi", async ({ page }) => {
    test.setTimeout(240_000);
    const { errors } = watchForErrors(page);

    // 3 talik guruh — oʻyin soni kam, mexanizm oʻsha
    await setupCategory(page, "Robofutbol", "fields-R", { groupSize: 3 });
    await loginJudge(page, PINS.R1);

    let played = 0;
    for (let i = 0; i < 80; i++) {
      const before = await pendingCount(page);
      if (before === 0) break;

      const card = nextMatchCard(page);
      await expand(card);

      const plus = card.getByRole("button", { name: /bitta qoʻshish/ });
      if ((await plus.count()) < 2) {
        await page.waitForTimeout(600);
        continue;
      }
      await plus.first().click();
      await card.getByRole("button", { name: /Yakunlash/ }).click();

      await expect
        .poll(() => pendingCount(page), { timeout: 15_000 })
        .not.toBe(before);
      played++;
    }

    expect(played, "guruh oʻyinlari oʻynaldi").toBeGreaterThan(5);

    // Pleyoff avtomatik tuzilgan boʻlishi kerak
    await page.goto("/admin/juftliklar?yonalish=robofutbol");
    await expect(page.getByText(/Pleyoff · \d+ ta/)).toBeVisible({ timeout: 20_000 });

    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});

test.describe("Hakam — linefollower", () => {
  test("taymer, +5s jarima, saqlash va bekor qilish", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginJudge(page, PINS.L1);

    const team = page.getByRole("listitem").first();
    await team.getByRole("button").first().click();

    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Jarima 5 s/ }).click();
    await expect(page.getByText(/× 5 s jarima/)).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();

    await page.getByRole("button", { name: "Saqlash" }).click();
    await expect(page.getByText(/1-urinish:/)).toBeVisible();

    await page.getByRole("button", { name: /Bekor qilish/ }).click();
    await expect(page.getByText(/1-urinish:/)).toBeHidden();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("DNF yoziladi va jonli tabloda koʻrinadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginJudge(page, PINS.L1);

    const team = page.getByRole("listitem").first();
    await team.getByRole("button").first().click();
    await page.getByRole("button", { name: "DNF", exact: true }).click();
    await expect(page.getByText(/1-urinish: DNF/)).toBeVisible();

    // ⚠️ Ilgari tablo «jerebyovka oʻtkazilmagan» deb natijani yashirardi
    await page.goto("/jonli/linefollower");
    await expect(page.getByText("DNF").first()).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("taymer ishlab turganda saqlash bloklanadi", async ({ page }) => {
    await loginJudge(page, PINS.L1);
    await page.getByRole("listitem").nth(2).getByRole("button").first().click();

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("button", { name: "Saqlash" })).toBeDisabled();
    await expect(page.getByText("Saqlash uchun avval taymerni toʻxtating")).toBeVisible();
  });

  test("ikkala urinishdan keyin yangi urinish yozib boʻlmaydi", async ({ page }) => {
    test.setTimeout(90_000);
    await loginJudge(page, PINS.L1);
    const team = page.getByRole("listitem").nth(3);
    await team.getByRole("button").first().click();

    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "DNF", exact: true }).click();
      await expect(page.getByText(/urinish: DNF/)).toBeVisible();
      // Bekor qilish oynasi tugashini kutamiz
      await expect(page.getByText(/urinish: DNF/)).toBeHidden({ timeout: 20_000 });
    }

    await expect(page.getByText("Ikkala urinish ham yozilgan")).toBeVisible();
  });
});

test.describe("Hakam — robrace", () => {
  test("gʻolib tanlanadi, vaqt ixtiyoriy, bekor qilish bor", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await setupCategory(page, "Robrace", "fields-RR");
    await loginJudge(page, PINS.RR1);

    const card = nextMatchCard(page);
    await expand(card);

    await expect(card.getByText("Kim birinchi keldi?")).toBeVisible();
    await card.locator('input[inputmode="decimal"]').first().fill("12.34");
    await card.getByRole("button", { name: /birinchi keldi/ }).first().click();

    await expect(page.getByText(/Gʻolib saqlandi/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Bekor qilish/ })).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});
