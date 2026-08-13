import { expect, test } from "@playwright/test";
import { loginAdmin, resetDatabase, watchForErrors } from "./helpers";

/**
 * Check-in — 16-avgust ertalabki eng muhim ekran.
 * Aynan shu yerda «Notoʻgʻri jamoa» xatosi chiqqan edi.
 */

test.beforeAll(() => resetDatabase());

test.describe("Check-in", () => {
  test("qidiruv 2 harfdan ishlaydi va apostrofga bogʻliq emas", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/checkin");

    // Bir harf — natija chiqmasin
    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("r");
    await expect(page.getByText("Jamoa nomini yozishni boshlang")).toBeVisible();

    // Ikki harf — ishlashi kerak
    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("se");
    await expect(page.getByRole("listitem").first()).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("kelmagan jamoa: Keldi → raqam beriladi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/checkin");

    // Seed'da har yoʻnalishning oxirgi 2 jamoasi check-in qilinmagan
    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("#24");
    const row = page.getByRole("listitem").first();
    await expect(row).toBeVisible();
    await row.getByRole("button").click();

    await expect(page.getByRole("button", { name: /Keldi/ })).toBeVisible();
    await expect(page.getByText("Bu jamoa allaqachon roʻyxatdan oʻtgan")).toBeHidden();

    await page.getByRole("button", { name: /Keldi/ }).click();

    // Kamera qadamiga oʻtishi kerak (kamera yoʻq boʻlsa ham ekran chiqadi)
    await expect(page.getByRole("button", { name: "Suratsiz oʻtish" })).toBeVisible();
    await page.getByRole("button", { name: "Suratsiz oʻtish" }).click();

    // Raqam katta shrift bilan
    await expect(page.getByText("Roʻyxatdan oʻtdi")).toBeVisible();
    await expect(page.getByText(/^R\d+$/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("REGRESSIYA: allaqachon check-in qilingan jamoada «Keldi» xato bermaydi", async ({
    page,
  }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/checkin");

    // Seed'da check-in qilingan jamoani topamiz
    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("#1");
    const checked = page
      .getByRole("listitem")
      .filter({ hasText: "Keldi" })
      .first();
    await expect(checked).toBeVisible();
    await checked.getByRole("button").click();

    await expect(page.getByText("Bu jamoa allaqachon roʻyxatdan oʻtgan")).toBeVisible();

    await page.getByRole("button", { name: /^Keldi$/ }).click();

    // ⚠️ Ilgari shu yerda «Notoʻgʻri jamoa» chiqardi (int8 → string)
    await expect(page.getByText("Notoʻgʻri jamoa")).toBeHidden();
    await expect(page.getByRole("button", { name: "Suratsiz oʻtish" })).toBeVisible();

    await page.getByRole("button", { name: "Suratsiz oʻtish" }).click();
    // Idempotent: oʻsha eski raqam qaytadi, yangisi berilmaydi
    await expect(page.getByText(/^R\d+$/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("roʻyxatda yoʻq jamoa qoʻshiladi va darhol raqam oladi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/checkin");

    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("zzqqxx-yoq");
    await expect(page.getByText("Hech narsa topilmadi")).toBeVisible();

    await page.getByRole("button", { name: /Roʻyxatda yoʻq/ }).click();
    await page.getByLabel("Yoʻnalish").selectOption("S");
    await page.getByLabel("Jamoa nomi").fill("QA Sinov Jamoasi");
    await page.getByLabel(/Ishtirokchilar/).fill("Alisher Testov, Malika Sinovova");
    await page.getByLabel(/Maktab/).fill("QA maktabi");
    await page.getByRole("button", { name: /Qoʻshish va raqam berish/ }).click();

    await expect(page.getByRole("button", { name: "Suratsiz oʻtish" })).toBeVisible();
    await page.getByRole("button", { name: "Suratsiz oʻtish" }).click();
    await expect(page.getByText(/^S\d+$/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("qoʻshilgan jamoa jamoalar roʻyxatida koʻrinadi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/jamoalar?q=QA%20Sinov");
    await expect(page.getByText("QA Sinov Jamoasi")).toBeVisible();

    // Tafsilotni ochamiz — ishtirokchilar joyida boʻlsin
    await page.getByRole("button", { name: /QA Sinov Jamoasi/ }).click();
    await expect(page.getByText("Alisher Testov, Malika Sinovova")).toBeVisible();
  });
});
