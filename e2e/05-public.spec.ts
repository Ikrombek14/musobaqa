import { expect, test } from "@playwright/test";
import { loginAdmin, watchForErrors } from "./helpers";

/**
 * Ommaviy qism faqat tomoshabin uchun.
 *
 * Bosh sahifada hakam va tashkilotchi havolalari BOʻLMASLIGI kerak:
 * tomoshabin tasodifan PIN soʻraydigan ekranga tushib chalkashmasin.
 * Sahifalar oʻzi baribir PIN/parol bilan himoyalangan — bu qoida
 * xavfsizlik uchun emas, auditoriya tozaligi uchun.
 */

test.describe("Bosh sahifa — faqat tomoshabin uchun", () => {
  test("jonli tablo koʻrsatiladi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Robototexnika musobaqasi" })).toBeVisible();

    // Har bir yoʻnalishga havola bor (navbarda ham, kartochkada ham)
    for (const name of ["Robofutbol", "Sumo", "Linefollower", "Robrace"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
    }

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("hakam va tashkilotchi havolalari YOʻQ", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: /Hakam/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Tashkilotchi/i })).toHaveCount(0);
    await expect(page.locator('a[href="/hakam"]')).toHaveCount(0);
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  });

  test("eski /jonli manzili bosh sahifaga olib boradi", async ({ page }) => {
    await page.goto("/jonli");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Robototexnika musobaqasi" })).toBeVisible();
  });

  test("hakam manzilni qoʻlda kiritib kira oladi", async ({ page }) => {
    await page.goto("/hakam");
    await expect(page.getByRole("heading", { name: "Hakam paneli" })).toBeVisible();
    await expect(page.getByLabel("PIN kod")).toBeVisible();
  });

  test("yoʻnalish sahifasi ochiladi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto("/");
    await page.getByRole("link", { name: /Robofutbol/ }).first().click();
    await expect(page).toHaveURL(/\/jonli\/robofutbol$/);
    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});

test.describe("QR kodlar", () => {
  test("hakam va admin uchun QR chop etishga tayyor", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/qr");

    await expect(page.getByRole("heading", { name: "Hakam paneli" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tashkilotchilar" })).toBeVisible();

    // QR SVG serverda generatsiya qilingan — mijozda JS kutilmaydi
    await expect(page.locator("svg[viewBox]").first()).toBeVisible();

    // Manzil matn sifatida ham koʻrinsin (QR skaner ishlamasa qoʻlda terish uchun)
    await expect(page.getByText(/\/hakam$/)).toBeVisible();

    await expect(page.getByRole("button", { name: "Chop etish" })).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});
