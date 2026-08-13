import { expect, test } from "@playwright/test";
import { loginAdmin, resetDatabase, watchForErrors } from "./helpers";

test.beforeAll(() => resetDatabase());

test.describe("Admin — sozlamalar", () => {
  test("maydonlar sonini oʻzgartirish saqlanadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/sozlamalar");

    const card = page.getByRole("region", { name: "Robofutbol" });
    await card.locator("#fields-R").fill("4");
    await card.getByRole("button", { name: "Saqlash", exact: true }).click();
    await expect(card.getByText(/Saqlandi/)).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("region", { name: "Robofutbol" }).locator("#fields-R"),
    ).toHaveValue("4");

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("jadval kalkulyatori slayder bilan darhol hisoblaydi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/sozlamalar");

    const card = page.getByRole("region", { name: "Robofutbol" });
    const duration = card.locator("aside p.tnum").first();
    const before = await duration.textContent();

    await card.locator("#mins-R").fill("20");
    await expect(duration).not.toHaveText(before ?? "");
  });

  test("jerebyovkadan keyin guruh oʻlchami qulflanadi", async ({ page }) => {
    await loginAdmin(page);
    // Avval jerebyovka oʻtkazamiz
    await page.goto("/admin/draw");
    const drawCard = page.getByRole("region", { name: "Robofutbol" });
    await drawCard.getByRole("button", { name: "Jerebyovka oʻtkazish" }).click();
    await drawCard.getByRole("button", { name: "Ha, oʻtkazilsin" }).click();
    await expect(drawCard.getByText(/guruh oʻyini/)).toBeVisible();

    await page.goto("/admin/sozlamalar");
    const card = page.getByRole("region", { name: "Robofutbol" });
    await expect(card.locator("#gsize-R")).toBeDisabled();
    await expect(card.getByText("Jerebyovka oʻtkazilgan — oʻzgartirib boʻlmaydi")).toBeVisible();
  });
});

test.describe("Admin — hakamlar CRUD", () => {
  test("qoʻshish, takroriy PIN bloki, tahrirlash, oʻchirish", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/hakamlar");

    await page.getByRole("button", { name: "Hakam qoʻshish" }).click();
    await page.getByLabel("Ism familiya").fill("Bekzod QA Rasulov");
    await page.getByLabel("Yoʻnalish").selectOption("S");
    await page.getByLabel("PIN kod").fill("7777");
    await page.getByRole("button", { name: "Qoʻshish", exact: true }).click();

    await expect(page.getByText("Bekzod QA Rasulov qoʻshildi")).toBeVisible();
    await expect(page.getByText("7777", { exact: true })).toBeVisible();

    // Takroriy PIN bloklanishi SHART — aks holda natija boshqa hakam
    // nomiga yozilib ketadi
    await page.getByRole("button", { name: "Hakam qoʻshish" }).click();
    await page.getByLabel("Ism familiya").fill("Ikkinchi QA");
    await page.getByLabel("PIN kod").fill("7777");
    await page.getByRole("button", { name: "Qoʻshish", exact: true }).click();
    await expect(page.getByText("Bu PIN boshqa hakamda bor")).toBeVisible();
    await page.getByRole("button", { name: "Bekor" }).click();

    // Tahrirlash
    const row = page.getByRole("listitem").filter({ hasText: "Bekzod QA Rasulov" });
    await row.getByRole("button", { name: /tahrirlash/i }).click();
    await page.getByLabel("Ism familiya").fill("Bekzod QA Yangilandi");
    await page.getByRole("button", { name: "Saqlash", exact: true }).click();
    await expect(page.getByText(/Bekzod QA Yangilandi yangilandi/)).toBeVisible();

    // Oʻchirish — natija yozmagan, ruxsat
    const updated = page.getByRole("listitem").filter({ hasText: "Bekzod QA Yangilandi" });
    await updated.getByRole("button", { name: /oʻchirish/i }).click();
    await updated.getByRole("button", { name: "Oʻchirilsin" }).click();
    await expect(page.getByText(/Bekzod QA Yangilandi oʻchirildi/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("qisqa PIN qabul qilinmaydi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/hakamlar");
    await page.getByRole("button", { name: "Hakam qoʻshish" }).click();
    await page.getByLabel("Ism familiya").fill("Qisqa PIN");
    await page.getByLabel("PIN kod").fill("12");
    await page.getByRole("button", { name: "Qoʻshish", exact: true }).click();
    await expect(page.getByText(/PIN 4–8 raqamdan/)).toBeVisible();
  });

  test("PIN taklifi boʻsh kod beradi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/hakamlar");
    await page.getByRole("button", { name: "Hakam qoʻshish" }).click();
    await page.getByRole("button", { name: "Taklif" }).click();
    await expect(page.getByLabel("PIN kod")).toHaveValue(/^\d{4}$/);
  });
});

test.describe("Admin — jerebyovka va juftliklar", () => {
  test("sumo jerebyovkasi toʻr tuzadi va juftliklar koʻrinadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/draw");

    const card = page.getByRole("region", { name: "Sumo" });
    await card.getByRole("button", { name: "Jerebyovka oʻtkazish" }).click();
    await card.getByRole("button", { name: "Ha, oʻtkazilsin" }).click();

    await expect(card.getByText(/jamoa · \d+ bosqich/)).toBeVisible();
    await expect(card.getByText(/^seed: [0-9a-f]{32}$/)).toBeVisible();

    await page.goto("/admin/juftliklar?yonalish=sumo");
    await expect(page.getByText(/Pleyoff · \d+ ta/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("ikkinchi marta jerebyovka oʻtkazib boʻlmaydi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/draw");
    const card = page.getByRole("region", { name: "Sumo" });
    await expect(card.getByText("Oʻtkazilgan")).toBeVisible();
    await expect(card.getByRole("button", { name: "Jerebyovka oʻtkazish" })).toBeHidden();
  });

  test("robofutbol guruh tarkiblari maktab bilan koʻrinadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/juftliklar?yonalish=robofutbol");

    await expect(page.getByRole("heading", { name: "Guruh tarkiblari" })).toBeVisible();
    await expect(page.getByText("A guruh").first()).toBeVisible();
    await expect(page.getByText(/Guruh oʻyinlari · \d+ ta/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("guruhni maydonga biriktirish oʻyinlarni koʻchiradi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/sozlamalar");

    const card = page.getByRole("region", { name: "Robofutbol" });
    await expect(
      card.getByRole("heading", { name: "Qaysi guruh qaysi maydonda" }),
    ).toBeVisible();
    await card.getByLabel("Robofutbol A guruh maydoni").selectOption("2");
    await card.getByRole("button", { name: "Guruh maydonlarini saqlash" }).click();
    await expect(card.getByText(/guruh saqlandi/)).toBeVisible();

    await page.goto("/admin/juftliklar?yonalish=robofutbol");
    await expect(page.getByText("2-maydon").first()).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});

test.describe("Admin — jamoalar", () => {
  test("filtr va qidiruv URL da saqlanadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/jamoalar");

    await page.getByRole("button", { name: "Sumo", exact: true }).click();
    await expect(page).toHaveURL(/category=S/);

    await page.getByRole("button", { name: "Kutilmoqda" }).click();
    await expect(page).toHaveURL(/status=waiting/);
    await expect(page.getByRole("row")).not.toHaveCount(0);

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("jamoa tahrirlanadi va saqlanadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/jamoalar?category=L");

    await page.getByRole("button", { name: "Tahrirlash" }).first().click();
    await page.getByLabel("Murabbiy").fill("QA Murabbiy");
    await page.getByRole("button", { name: "Saqlash", exact: true }).click();
    await expect(page.getByText(/saqlandi/)).toBeVisible();

    await page.reload();
    await expect(page.getByText("QA Murabbiy").first()).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("jadvalga tushgan jamoani oʻchirib boʻlmaydi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/jamoalar?category=R&status=checked");

    const row = page.getByRole("row").nth(1);
    await row.getByRole("button", { name: "Oʻchirish" }).click();
    await row.getByRole("button", { name: "Oʻchirish" }).click();
    await expect(page.getByText(/jadvalga kiritilgan/)).toBeVisible();
  });
});
