import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL kerak"),
  /** iron-session uchun, kamida 32 belgi */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET kamida 32 belgi boʻlsin"),
  ADMIN_PASSWORD: z.string().min(4, "ADMIN_PASSWORD kerak"),
  /**
   * Qoʻshimcha admin hisoblari: `ism:parol,ism:parol`.
   *
   * Roʻyxatdan oʻtkazish stolida bir necha odam ishlaydi va har biri oʻz
   * paroli bilan kirsin — audit jurnalida kim nima qilgani aniq qoladi.
   * Boʻsh boʻlsa faqat ADMIN_PASSWORD ishlaydi.
   */
  ADMIN_USERS: z.string().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Muhit sozlamalari notoʻgʻri:\n${issues}`);
}

export const env = parsed.data;
