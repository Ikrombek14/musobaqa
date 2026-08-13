"use server";

import { revalidatePath } from "next/cache";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { isCategoryCode } from "@/lib/categories";
import { toId } from "@/lib/validate";

export type JudgeState =
  | { ok: true; message: string; pin?: string }
  | { ok: false; error: string };

const judgeSchema = z.object({
  name: z.string().trim().min(3, "Ism familiya kamida 3 belgi").max(120),
  categoryCode: z.string().refine(isCategoryCode, "Yoʻnalish tanlanmagan"),
  fieldNo: z
    .string()
    .transform((v) => (v === "" || v === "all" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 20), "Maydon notoʻgʻri"),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "PIN 4–8 raqamdan iborat boʻlsin"),
});

/**
 * PIN noyob boʻlishi SHART.
 *
 * Kirishda qaysi hakam ekanini faqat PIN aytadi — ikki hakamda bir xil PIN
 * boʻlsa, natija boshqa hakamning nomiga yozilib qoladi. Argon2 hash'ni
 * teskari oʻqib boʻlmagani uchun mavjud hakamlar boʻyicha verify qilib
 * tekshiramiz (hakamlar soni oʻnlab — arzon amal).
 */
async function pinTaken(pin: string, exceptId?: number): Promise<boolean> {
  const rows = await db
    .select({ id: schema.judges.id, pinHash: schema.judges.pinHash })
    .from(schema.judges);

  for (const row of rows) {
    if (exceptId && row.id === exceptId) continue;
    if (await verify(row.pinHash, pin)) return true;
  }
  return false;
}

export async function createJudge(
  _prev: JudgeState | null,
  formData: FormData,
): Promise<JudgeState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const parsed = judgeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Maʼlumot notoʻgʻri" };
  }
  const input = parsed.data;

  try {
    if (await pinTaken(input.pin)) {
      return { ok: false, error: "Bu PIN boshqa hakamda bor — boshqasini tanlang" };
    }

    const [judge] = await db
      .insert(schema.judges)
      .values({
        name: input.name,
        categoryCode: input.categoryCode,
        fieldNo: input.fieldNo,
        pinHash: await hash(input.pin),
      })
      .returning({ id: schema.judges.id });

    await db.insert(schema.auditLog).values({
      actor: admin.name,
      action: "judge.create",
      entity: "judge",
      entityId: String(judge.id),
      after: { name: input.name, categoryCode: input.categoryCode, fieldNo: input.fieldNo },
    });

    revalidatePath("/admin/hakamlar");
    return {
      ok: true,
      message: `${input.name} qoʻshildi`,
      pin: input.pin,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function updateJudge(
  _prev: JudgeState | null,
  formData: FormData,
): Promise<JudgeState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Hakam topilmadi" };

  // PIN ixtiyoriy: boʻsh boʻlsa eski PIN saqlanadi
  const rawPin = String(formData.get("pin") ?? "").trim();
  const base = judgeSchema.omit({ pin: true }).safeParse(Object.fromEntries(formData));
  if (!base.success) {
    return { ok: false, error: base.error.issues[0]?.message ?? "Maʼlumot notoʻgʻri" };
  }
  if (rawPin && !/^\d{4,8}$/.test(rawPin)) {
    return { ok: false, error: "PIN 4–8 raqamdan iborat boʻlsin" };
  }

  try {
    const [current] = await db
      .select()
      .from(schema.judges)
      .where(eq(schema.judges.id, id));
    if (!current) return { ok: false, error: "Hakam topilmadi" };

    if (rawPin && (await pinTaken(rawPin, id))) {
      return { ok: false, error: "Bu PIN boshqa hakamda bor" };
    }

    await db
      .update(schema.judges)
      .set({
        name: base.data.name,
        categoryCode: base.data.categoryCode,
        fieldNo: base.data.fieldNo,
        ...(rawPin ? { pinHash: await hash(rawPin) } : {}),
      })
      .where(eq(schema.judges.id, id));

    await db.insert(schema.auditLog).values({
      actor: admin.name,
      action: "judge.update",
      entity: "judge",
      entityId: String(id),
      before: {
        name: current.name,
        categoryCode: current.categoryCode,
        fieldNo: current.fieldNo,
      },
      after: { ...base.data, pinChanged: Boolean(rawPin) },
    });

    revalidatePath("/admin/hakamlar");
    return {
      ok: true,
      message: rawPin ? `${base.data.name} yangilandi, PIN almashtirildi` : `${base.data.name} yangilandi`,
      pin: rawPin || undefined,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function setJudgeActive(rawId: unknown, active: boolean): Promise<JudgeState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const id = toId(rawId);
  if (id === null) return { ok: false, error: "Hakam topilmadi" };

  try {
    const [judge] = await db
      .update(schema.judges)
      .set({ active })
      .where(eq(schema.judges.id, id))
      .returning({ name: schema.judges.name });
    if (!judge) return { ok: false, error: "Hakam topilmadi" };

    await db.insert(schema.auditLog).values({
      actor: admin.name,
      action: active ? "judge.activate" : "judge.deactivate",
      entity: "judge",
      entityId: String(id),
    });

    revalidatePath("/admin/hakamlar");
    return {
      ok: true,
      message: active ? `${judge.name} faollashtirildi` : `${judge.name} vaqtincha oʻchirildi`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Oʻchirish.
 *
 * Hakam natija yozgan boʻlsa OʻCHIRILMAYDI — `matches.judge_id` orqali
 * «kim yozgan» izi yoʻqolib ketmasligi kerak. Bunday holda faollikdan
 * chiqarish taklif qilinadi.
 */
export async function deleteJudge(rawId: unknown): Promise<JudgeState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const id = toId(rawId);
  if (id === null) return { ok: false, error: "Hakam topilmadi" };

  try {
    const [judge] = await db
      .select({ name: schema.judges.name })
      .from(schema.judges)
      .where(eq(schema.judges.id, id));
    if (!judge) return { ok: false, error: "Hakam topilmadi" };

    const [usedInMatch] = await db
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(eq(schema.matches.judgeId, id))
      .limit(1);
    const [usedInRun] = await db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(eq(schema.runs.judgeId, id))
      .limit(1);

    if (usedInMatch || usedInRun) {
      return {
        ok: false,
        error:
          "Bu hakam natija yozgan — oʻchirib boʻlmaydi. Oʻrniga «Faolsiz» qilib qoʻying.",
      };
    }

    await db.delete(schema.judges).where(eq(schema.judges.id, id));
    await db.insert(schema.auditLog).values({
      actor: admin.name,
      action: "judge.delete",
      entity: "judge",
      entityId: String(id),
      before: { name: judge.name },
    });

    revalidatePath("/admin/hakamlar");
    return { ok: true, message: `${judge.name} oʻchirildi` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Takrorlanmaydigan tasodifiy 4 xonali PIN taklif qiladi. */
export async function suggestPin(): Promise<string> {
  await requireAdmin();
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const pin = String(1000 + (bytes[0] % 9000));
    if (!(await pinTaken(pin))) return pin;
  }
  throw new Error("Boʻsh PIN topilmadi");
}

