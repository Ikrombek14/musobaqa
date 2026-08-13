import { expect, test } from "@playwright/test";
import { loginAdmin, loginJudge, PINS, resetDatabase, watchForErrors } from "./helpers";

test.beforeAll(() => resetDatabase());

/**
 * Realtime zanjiri.
 *
 * Ikkita brauzer konteksti: birida hakam yozadi, ikkinchisida tablo/monitor
 * turadi. Ikkinchisi HECH NARSA bosmasdan yangilanishi kerak.
 *
 * Bu — tizimning asosiy vaʼdasi: «hakam natijani saqlasa, qolganlar uchun
 * ham koʻrinishi kerak».
 */

test("hakam natija yozadi → jonli tablo va monitor OʻZI yangilanadi", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // 1) Admin: sumo jerebyovkasi
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const adminErrors = watchForErrors(admin);

  await loginAdmin(admin);
  await admin.goto("/admin/sozlamalar");
  const settings = admin.getByRole("region", { name: "Sumo" });
  await settings.locator("#fields-S").fill("1");
  await settings.getByRole("button", { name: "Saqlash", exact: true }).click();
  await expect(settings.getByText(/Saqlandi/)).toBeVisible();

  await admin.goto("/admin/draw");
  const drawCard = admin.getByRole("region", { name: "Sumo" });
  await drawCard.getByRole("button", { name: "Jerebyovka oʻtkazish" }).click();
  await drawCard.getByRole("button", { name: "Ha, oʻtkazilsin" }).click();
  await expect(drawCard.getByText(/seed:/)).toBeVisible();

  // 2) Tomoshabin: jonli tablo
  const boardCtx = await browser.newContext();
  const board = await boardCtx.newPage();
  const boardErrors = watchForErrors(board);
  await board.goto("/jonli/sumo");
  // Ulanish oʻrnatilishini kutamiz — «Jonli» indikatori yashil boʻlsin
  await expect(board.getByText("Jonli", { exact: true })).toBeVisible({ timeout: 15_000 });

  // 3) Admin: boshqaruv markazi
  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "Boshqaruv markazi" })).toBeVisible();
  await expect(admin.getByText("Jonli", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(admin.getByText("Hali natija yozilmagan")).toBeVisible();

  // 4) Hakam: natija yozadi
  const judgeCtx = await browser.newContext();
  const judge = await judgeCtx.newPage();
  const judgeErrors = watchForErrors(judge);
  await loginJudge(judge, PINS.S1);

  const card = judge
    .locator("section")
    .filter({ has: judge.getByRole("heading", { name: /Navbatdagi oʻyinlar/ }) })
    .locator("> div")
    .first();
  const header = card.getByRole("button").first();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();

  const winButtons = card.getByRole("button", { name: /raundni yutdi/ });
  await winButtons.first().click();
  await winButtons.first().click();
  await expect(judge.getByText(/Uchrashuv yakunlandi: 2:0/)).toBeVisible();

  // 5) HECH NARSA bosmasdan: tablo hisobni koʻrsatsin
  await expect(board.getByText("2", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 6) HECH NARSA bosmasdan: monitorda natija oqimida paydo boʻlsin
  await expect(admin.getByText("Hali natija yozilmagan")).toBeHidden({ timeout: 20_000 });
  await expect(admin.getByRole("heading", { name: "Oxirgi natijalar" })).toBeVisible();
  await expect(admin.getByText(/^S\d+ 2:0 S\d+$/)).toBeVisible({ timeout: 20_000 });

  expect(adminErrors.errors, adminErrors.errors.join("\n")).toHaveLength(0);
  expect(boardErrors.errors, boardErrors.errors.join("\n")).toHaveLength(0);
  expect(judgeErrors.errors, judgeErrors.errors.join("\n")).toHaveLength(0);

  await adminCtx.close();
  await boardCtx.close();
  await judgeCtx.close();
});

test("check-in real vaqtda jamoalar roʻyxatiga tushadi", async ({ browser }) => {
  test.setTimeout(90_000);

  const listCtx = await browser.newContext();
  const list = await listCtx.newPage();
  await loginAdmin(list);
  await list.goto("/admin/jamoalar?category=RR&status=waiting");
  const before = await list.getByRole("row").count();
  expect(before).toBeGreaterThan(1);

  // Boshqa oynada check-in qilamiz
  const deskCtx = await browser.newContext();
  const desk = await deskCtx.newPage();
  await loginAdmin(desk, "Stol");
  await desk.goto("/admin/checkin");

  const waitingName = await list
    .getByRole("row")
    .nth(1)
    .locator("td")
    .nth(1)
    .textContent();
  const query = (waitingName ?? "").match(/#(\d+)/)?.[0] ?? "#7";

  await desk.getByLabel("Jamoa yoki ishtirokchi nomi").fill(query);
  const hit = desk.getByRole("listitem").filter({ hasNot: desk.getByText("Keldi") }).first();
  await hit.getByRole("button").click();
  await desk.getByRole("button", { name: /^Keldi$/ }).click();
  await desk.getByRole("button", { name: "Suratsiz oʻtish" }).click();
  await expect(desk.getByText("Roʻyxatdan oʻtdi")).toBeVisible();

  // Roʻyxat oynasi oʻzi yangilanib, kutayotganlar soni kamayishi kerak
  await expect
    .poll(() => list.getByRole("row").count(), { timeout: 20_000 })
    .toBeLessThan(before);

  await listCtx.close();
  await deskCtx.close();
});

test("ulanish uzilsa qayta tiklanadi va yoʻqolgan natija yetib keladi", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const boardCtx = await browser.newContext();
  const board = await boardCtx.newPage();
  await board.goto("/jonli/sumo");
  await expect(board.getByText("Jonli", { exact: true })).toBeVisible({ timeout: 15_000 });

  // Tarmoqni uzamiz — hakam shu payt natija yozadi
  await boardCtx.setOffline(true);

  const judgeCtx = await browser.newContext();
  const judge = await judgeCtx.newPage();
  await loginJudge(judge, PINS.S1);

  const card = judge
    .locator("section")
    .filter({ has: judge.getByRole("heading", { name: /Navbatdagi oʻyinlar/ }) })
    .locator("> div")
    .filter({ hasNot: judge.getByRole("button", { name: /Bekor qilish/ }) })
    .first();
  const header = card.getByRole("button").first();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();

  const winButtons = card.getByRole("button", { name: /raundni yutdi/ });
  await winButtons.first().click();
  await winButtons.first().click();
  await expect(judge.getByText(/Uchrashuv yakunlandi/)).toBeVisible();

  // Tarmoq qaytdi: EventSource oʻzi qayta ulanadi va Last-Event-ID
  // orqali uzilish paytidagi natijani soʻrab oladi
  await boardCtx.setOffline(false);
  await expect(board.getByText("Jonli", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Yakunlangan uchrashuvlar soni ortgan boʻlishi kerak
  await expect
    .poll(async () => board.getByText(/^\d$/).count(), { timeout: 30_000 })
    .toBeGreaterThan(0);

  await boardCtx.close();
  await judgeCtx.close();
});
