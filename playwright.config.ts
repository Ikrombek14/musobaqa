import { defineConfig, devices } from "@playwright/test";

/**
 * QA sinovlari HAQIQIY brauzerda ishlaydi.
 *
 * Nega shart: check-in'dagi «Notoʻgʻri jamoa» xatosi sof funksiya va baza
 * sinovlaridan sirgʻalib oʻtgan edi, chunki u Server Action bilan
 * soʻrov chegarasida yashiringan. Faqat haqiqiy klik zanjiri
 * (brauzer → action → baza → SSE → brauzer) bunday xatoni topadi.
 *
 * Sinovlar KETMA-KET ishlaydi (`workers: 1`): hammasi bitta bazaga
 * yozadi, parallel ishlasa bir-birining maʼlumotini buzadi.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    /**
     * PRODUCTION build'ga urinadi (3100), dev serverga emas.
     *
     * Dev rejimda Next sahifani soʻrov paytida kompilyatsiya qiladi va
     * hydration kechikadi — natijada sinov yozgan matn yoʻqolib, xato
     * «topilmadi» deb koʻrinadi. Musobaqa kuni ham prod build ishlaydi,
     * demak sinov ham oʻshani tekshirishi kerak.
     */
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "uz-UZ",
    timezoneId: "Asia/Tashkent",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
