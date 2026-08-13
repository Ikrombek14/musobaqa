import { expect, test } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loginAdmin, resetDatabase, watchForErrors } from "./helpers";

test.beforeAll(() => resetDatabase());

/**
 * Excel import — haqiqiy fayl bilan.
 *
 * CSV ishlatiladi: exceljs uni ham xuddi .xlsx kabi oʻqiydi, sinovda
 * esa faylni yaratish oson va tez.
 */
async function makeCsv(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "musobaqa-import-"));
  const file = path.join(dir, name);
  // BOM — Excel va exceljs UTF-8 ni toʻgʻri oʻqishi uchun
  await writeFile(file, "﻿" + content, "utf8");
  return file;
}

const SAMPLE = [
  "Yoʻnalish,Jamoa nomi,Ishtirokchi 1,Ishtirokchi 2,Maktab,Murabbiy",
  "Robofutbol,Import Chaqmoq,Ali Valiyev,Vali Aliyev,110-maktab,Bekzod R",
  "robofutbol,Import Yulduz,Nodira K,,233-maktab,Bekzod R",
  "Sumo,,Malika Rasulova,,Prezident maktabi,Dilshod T",
  "linefollower,Import Vektor,Sardor B,Aziz N,Robotics Lab,",
  "shaxmat,Notoʻgʻri jamoa,Kimdir,,,",
  ",,,,,",
].join("\n");

test.describe("Excel import", () => {
  test("fayl yuklanadi, ustunlar avtomatik topiladi, preview koʻrinadi", async ({
    page,
  }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/import");

    const file = await makeCsv("jamoalar.csv", SAMPLE);
    await page.locator("#import-file").setInputFiles(file);

    // Ustunlar avtomatik moslanadi.
    // `#map-*` id bilan: sarlavha matni ishtirokchi belgilarida ham
    // takrorlanadi, shuning uchun label boʻyicha qidirish noaniq.
    await expect(page.locator("#map-categoryCode")).toHaveValue("0");
    await expect(page.locator("#map-name")).toHaveValue("1");
    await expect(page.locator("#map-school")).toHaveValue("4");
    await expect(page.locator("#map-coach")).toHaveValue("5");

    // 4 ta toʻgʻri, 1 tasi notanish yoʻnalish
    await expect(page.getByText("Qoʻshiladi")).toBeVisible();
    await expect(page.getByRole("button", { name: /4 ta jamoani qoʻshish/ })).toBeVisible();
    await expect(page.getByText(/Yoʻnalish tanilmadi/)).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("import qilinadi, jamoalar roʻyxatida koʻrinadi va RAQAMSIZ boʻladi", async ({
    page,
  }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/import");

    const file = await makeCsv("jamoalar.csv", SAMPLE);
    await page.locator("#import-file").setInputFiles(file);
    await page.getByRole("button", { name: /4 ta jamoani qoʻshish/ }).click();

    await expect(page.getByText("Import tugadi")).toBeVisible();
    await expect(page.getByText(/4 ta jamoa qoʻshildi/)).toBeVisible();

    // Roʻyxatda
    await page.goto("/admin/jamoalar?q=Import");
    await expect(page.getByText("Import Chaqmoq")).toBeVisible();
    await expect(page.getByText("Import Vektor")).toBeVisible();

    // Nomsiz qator ishtirokchi ismini oldi
    await page.goto("/admin/jamoalar?q=Malika");
    await expect(page.getByText("Malika Rasulova").first()).toBeVisible();

    // Raqam BERILMAGAN — u check-in paytida beriladi
    await page.goto("/admin/jamoalar?status=waiting");
    await expect(page.getByText("Kutilmoqda").first()).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("qayta import takror yaratmaydi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/import");

    const file = await makeCsv("jamoalar.csv", SAMPLE);
    await page.locator("#import-file").setInputFiles(file);
    await page.getByRole("button", { name: /jamoani qoʻshish/ }).click();

    await expect(page.getByText("Import tugadi")).toBeVisible();
    await expect(page.getByText(/0 ta jamoa qoʻshildi/)).toBeVisible();
    await expect(page.getByText(/takror oʻtkazib yuborildi/)).toBeVisible();
  });

  test("notoʻgʻri format rad etiladi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/import");

    const file = await makeCsv("hujjat.txt", "salom");
    await page.locator("#import-file").setInputFiles(file);
    await expect(page.getByText(/Faqat .xlsx yoki .csv/)).toBeVisible();
  });

  test("ustunni qoʻlda oʻzgartirsa preview yangilanadi", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/import");

    const file = await makeCsv("jamoalar.csv", SAMPLE);
    await page.locator("#import-file").setInputFiles(file);

    // Yoʻnalish ustunini «yoʻq» qilsak — hech biri import qilinmaydi
    await page.locator("#map-categoryCode").selectOption("");
    await expect(page.getByRole("button", { name: /0 ta jamoani qoʻshish/ })).toBeDisabled();
    await expect(page.getByText(/Yoʻnalish koʻrsatilmagan/).first()).toBeVisible();
  });
});

test.describe("Roʻyxatdan oʻtkazish formasi soddalashtirilgan", () => {
  test("faqat yoʻnalish va ishtirokchilar soʻraladi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/checkin");

    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("zzqqxx-yoq");
    await expect(page.getByText("Hech narsa topilmadi")).toBeVisible();
    await page.getByRole("button", { name: /Roʻyxatda yoʻq/ }).click();

    await expect(page.getByLabel("Yoʻnalish")).toBeVisible();
    await expect(page.getByLabel(/Ishtirokchilar/)).toBeVisible();
    await expect(page.getByLabel(/Jamoa nomi/)).toBeVisible();

    // Bular endi soʻralmaydi
    await expect(page.getByLabel(/Maktab/)).toHaveCount(0);
    await expect(page.getByLabel(/Murabbiy/)).toHaveCount(0);
    await expect(page.getByLabel(/Telefon/)).toHaveCount(0);

    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("jamoa nomisiz ham qoʻshiladi — ishtirokchi ismi olinadi", async ({ page }) => {
    const { errors } = watchForErrors(page);
    await loginAdmin(page);
    await page.goto("/admin/checkin");

    await page.getByLabel("Jamoa yoki ishtirokchi nomi").fill("zzqqxx-yoq");
    await page.getByRole("button", { name: /Roʻyxatda yoʻq/ }).click();

    await page.getByLabel("Yoʻnalish").selectOption("RC");
    await page.getByLabel(/Ishtirokchilar/).fill("Nomsiz Ishtirokchi, Ikkinchi Bola");
    await page.getByRole("button", { name: /Qoʻshish va raqam berish/ }).click();

    await expect(page.getByRole("button", { name: "Suratsiz oʻtish" })).toBeVisible();
    await page.getByRole("button", { name: "Suratsiz oʻtish" }).click();

    await expect(page.getByText(/^RC\d+$/)).toBeVisible();
    await expect(page.getByText("Nomsiz Ishtirokchi")).toBeVisible();

    expect(errors, errors.join("\n")).toHaveLength(0);
  });
});
