import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "qara2026";

/** Seed'dagi hakam PIN kodlari */
export const PINS = {
  R1: "1001",
  R2: "1002",
  R3: "1003",
  S1: "1004",
  S2: "1005",
  L1: "1006",
  L2: "1007",
  RR1: "1008",
  RR2: "1009",
} as const;

/**
 * Bazani sinovdan oldingi holatga qaytaradi.
 *
 * Har sinov toza maʼlumotdan boshlanishi shart: aks holda bir sinovning
 * jerebyovkasi keyingisining natijasini buzadi va xato qaysi sinovdan
 * chiqqani noaniq boʻlib qoladi.
 */
export function resetDatabase() {
  // Lokalda sozlamalar `.env.local` da, CI'da esa job muhitida keladi
  const useEnvFile = existsSync(".env.local");
  const args = [
    "tsx",
    ...(useEnvFile ? ["--env-file=.env.local"] : []),
    "scripts/seed.ts",
    "--force",
  ];

  execFileSync("npx", args, { stdio: "pipe", shell: true, timeout: 120_000 });
}

export async function loginAdmin(page: Page, name = "QA") {
  await page.goto("/admin");
  const password = page.getByLabel("Parol");
  if (await password.isVisible().catch(() => false)) {
    await page.getByLabel("Ismingiz").fill(name);
    await password.fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Kirish" }).click();
  }
  await expect(page.getByRole("link", { name: "Jerebyovka" })).toBeVisible();
}

export async function loginJudge(page: Page, pin: string) {
  await page.goto("/hakam");
  const input = page.getByLabel("PIN kod");
  if (await input.isVisible().catch(() => false)) {
    await input.fill(pin);
    await page.getByRole("button", { name: "Kirish" }).click();
  }
  await expect(page.getByRole("button", { name: "Chiqish" })).toBeVisible();
}

/** Sahifada konsol xatosi yoki 500 javob boʻlmasligini kuzatadi. */
export function watchForErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Brauzerning oʻz shovqini — bizning xatomiz emas
    if (/favicon|net::ERR_ABORTED|Download the React DevTools/i.test(text)) return;
    errors.push(`console: ${text}`);
  });

  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  page.on("response", (res) => {
    if (res.status() >= 500) errors.push(`HTTP ${res.status()}: ${res.url()}`);
  });

  return { errors };
}
