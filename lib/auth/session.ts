import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { CategoryCode } from "@/lib/categories";

export type Session = {
  admin?: { name: string; at: number };
  judge?: {
    id: number;
    name: string;
    categoryCode: CategoryCode;
    fieldNo: number | null;
    at: number;
  };
};

const options: SessionOptions = {
  password: env.SESSION_SECRET,
  cookieName: "qara_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    // Lokal sinovda HTTPS yo'q — prodda majburiy
    secure: env.NODE_ENV === "production",
    maxAge: 60 * 60 * 16, // musobaqa kuni davomida
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<Session>(await cookies(), options);
}

/** Vaqt hujumiga chidamli taqqoslash — parol uzunligi ham sizib chiqmaydi. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Uzunlik farq qilsa ham bir xil vaqt sarflaymiz
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function checkAdminPassword(password: string): boolean {
  return safeEqual(password, env.ADMIN_PASSWORD);
}

/**
 * Parolga qarab admin ismini aniqlaydi.
 *
 * Umumiy parol (`ADMIN_PASSWORD`) bilan kirilsa — odam oʻzi yozgan ism
 * ishlatiladi. Shaxsiy parol (`ADMIN_USERS`) bilan kirilsa — roʻyxatdagi
 * ism, chunki audit jurnalida kim ekani aniq boʻlishi kerak.
 *
 * `null` — parol notoʻgʻri.
 */
export function resolveAdminName(password: string, typedName: string): string | null {
  if (checkAdminPassword(password)) return typedName.trim() || "Admin";

  for (const entry of (env.ADMIN_USERS ?? "").split(",")) {
    const [name, secret] = entry.split(":");
    if (!name || !secret) continue;
    if (safeEqual(password, secret.trim())) return name.trim();
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Server Action / sahifa himoyasi                                     */
/*                                                                     */
/* Har bir Server Action — ochiq endpoint. Yozishdan OLDIN shu          */
/* funksiyalar chaqiriladi, aks holda kim xohlasa natija yozadi.        */
/* ------------------------------------------------------------------ */

export class AuthError extends Error {
  constructor(message = "Ruxsat yoʻq") {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session.admin) throw new AuthError("Admin sifatida kiring");
  return session.admin;
}

export async function requireJudge() {
  const session = await getSession();
  if (!session.judge) throw new AuthError("Hakam sifatida kiring");
  return session.judge;
}

/** Admin ham, hakam ham ruxsat etilgan joylar uchun (masalan check-in). */
export async function requireStaff() {
  const session = await getSession();
  if (session.admin) return { kind: "admin" as const, name: session.admin.name };
  if (session.judge) return { kind: "judge" as const, name: session.judge.name };
  throw new AuthError();
}
