"use server";

import { revalidatePath } from "next/cache";
import { checkAdminPassword, getSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export type LoginState = { error?: string };

/** Sodda kechikish — parol topishga urinishni qimmatlashtiradi. */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function adminLogin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim() || "Admin";

  if (!password) return { error: "Parolni kiriting" };

  if (!checkAdminPassword(password)) {
    await delay(600);
    return { error: "Parol notoʻgʻri" };
  }

  const session = await getSession();
  session.admin = { name, at: Date.now() };
  await session.save();

  await db.insert(schema.auditLog).values({
    actor: name,
    action: "admin.login",
    entity: "session",
  });

  revalidatePath("/admin", "layout");
  return {};
}

export async function adminLogout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  revalidatePath("/admin", "layout");
}
