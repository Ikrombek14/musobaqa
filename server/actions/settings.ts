"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { requireAdmin } from "@/lib/auth/session";
import { CATEGORIES, isCategoryCode } from "@/lib/categories";
import { assignFields, createPlayoffBracket } from "@/server/lib/progression";
import { toId, toInt } from "@/lib/validate";

export type SettingsState = { ok: true; message: string } | { ok: false; error: string };

const settingsSchema = z.object({
  categoryCode: z.string().refine(isCategoryCode, "Notoʻgʻri yoʻnalish"),
  fieldCount: z.coerce.number().int().min(1, "Kamida 1 maydon").max(20, "Koʻpi bilan 20 maydon"),
  groupSize: z.coerce.number().int().min(2, "Guruh kamida 2 talik").max(12, "Koʻpi bilan 12 talik"),
  matchMinutes: z.coerce.number().int().min(1, "Kamida 1 daqiqa").max(60, "Koʻpi bilan 60 daqiqa"),
  advancePerGroup: z.coerce
    .number()
    .int()
    .min(1, "Kamida 1 ta chiqadi")
    .max(4, "Koʻpi bilan 4 ta")
    .optional()
    .default(1),
});

/**
 * Yoʻnalish sozlamalari.
 *
 * Guruh oʻlchamini faqat jerebyovkagacha oʻzgartirish mumkin — undan keyin
 * guruhlar allaqachon tuzilgan, oʻzgartirish jadvalni buzadi.
 *
 * Maydonlar sonini esa musobaqa davomida ham oʻzgartirsa boʻladi (maydon
 * buzildi, qoʻshimcha stol qoʻyildi). Bunda YAKUNLANMAGAN va hali
 * boshlanmagan oʻyinlar qaytadan taqsimlanadi; ketayotgan oʻyin tegilmaydi.
 */
export async function updateCategorySettings(
  _prev: SettingsState | null,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Qiymat notoʻgʻri" };
  }
  const input = parsed.data;
  const categoryCode = input.categoryCode as keyof typeof CATEGORIES;

  try {
    const message = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.code, categoryCode))
        .for("update");
      if (!current) throw new Error("Yoʻnalish topilmadi");

      if (current.drawLocked && current.groupSize !== input.groupSize) {
        throw new Error(
          "Jerebyovka oʻtkazilgan — guruh oʻlchamini oʻzgartirib boʻlmaydi. Avval jerebyovkani bekor qiling.",
        );
      }

      const fieldsChanged = current.fieldCount !== input.fieldCount;

      await tx
        .update(schema.categories)
        .set({
          fieldCount: input.fieldCount,
          groupSize: input.groupSize,
          matchMinutes: input.matchMinutes,
          advancePerGroup: input.advancePerGroup,
        })
        .where(eq(schema.categories.code, categoryCode));

      /**
       * Guruhdan chiqish soni oʻzgarsa va pleyoff ALLAQACHON tuzilgan
       * boʻlsa — toʻr qaytadan tuziladi.
       *
       * Faqat hech bir pleyoff oʻyini boshlanmagan boʻlsa: aks holda
       * oʻynab boʻlingan chorak final natijasi yoʻqolardi.
       */
      let rebuilt = 0;
      if (current.advancePerGroup !== input.advancePerGroup) {
        const playoff = await tx
          .select({ id: schema.matches.id, status: schema.matches.status })
          .from(schema.matches)
          .where(
            and(
              eq(schema.matches.categoryCode, categoryCode),
              eq(schema.matches.stage, "playoff"),
            ),
          );

        if (playoff.length > 0) {
          const started = playoff.some((m) => m.status !== "pending");
          if (started) {
            throw new Error(
              "Pleyoff boshlangan — guruhdan chiqish sonini oʻzgartirib boʻlmaydi.",
            );
          }

          const groupMatches = await tx
            .select({
              groupId: schema.matches.groupId,
              teamAId: schema.matches.teamAId,
              teamBId: schema.matches.teamBId,
              scoreA: schema.matches.scoreA,
              scoreB: schema.matches.scoreB,
              status: schema.matches.status,
            })
            .from(schema.matches)
            .where(
              and(
                eq(schema.matches.categoryCode, categoryCode),
                eq(schema.matches.stage, "group"),
              ),
            );

          await tx
            .delete(schema.matches)
            .where(
              and(
                eq(schema.matches.categoryCode, categoryCode),
                eq(schema.matches.stage, "playoff"),
              ),
            );

          const result = await createPlayoffBracket(
            tx,
            categoryCode,
            groupMatches,
            input.fieldCount,
            admin.name,
          );
          rebuilt = result.qualified.length;

          await emit(tx, categoryCode, "match.updated", {
            structure: true,
            reason: "playoff.rebuilt",
          });
        }
      }

      let redistributed = 0;
      if (fieldsChanged) {
        /*
          1) Guruhlar maydonlarga QAYTA taqsimlanadi: A→1, B→2, C→1 …
             Ilgari chegaradan chiqqan guruh «Avtomatik» boʻlib qolardi
             va uning oʻyinlari yuk boʻyicha sochilib ketardi — bitta
             guruh bitta maydonda degan qoida buzilardi.
        */
        const allGroups = await tx
          .select({ id: schema.groups.id })
          .from(schema.groups)
          .where(eq(schema.groups.categoryCode, categoryCode))
          .orderBy(asc(schema.groups.name));

        for (const [index, group] of allGroups.entries()) {
          await tx
            .update(schema.groups)
            .set({ fieldNo: (index % input.fieldCount) + 1 })
            .where(eq(schema.groups.id, group.id));
        }

        // 2) Boshlanmagan oʻyinlarning maydonini boʻshatamiz.
        //    Ketayotgan (`live`) va yakunlangan oʻyinlar tegilmaydi.
        const cleared = await tx
          .update(schema.matches)
          .set({ fieldNo: null })
          .where(
            and(
              eq(schema.matches.categoryCode, categoryCode),
              eq(schema.matches.status, "pending"),
              eq(schema.matches.isBye, false),
            ),
          )
          .returning({ id: schema.matches.id });

        // 3) Qaytadan taqsimlaymiz. assignFields guruh biriktiruvini
        //    hurmat qiladi, shuning uchun qatʼiy guruhlar oʻz maydonini
        //    qaytarib oladi.
        redistributed = cleared.length;
        await assignFields(tx, categoryCode, input.fieldCount);
      }

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "settings.update",
        entity: "category",
        entityId: categoryCode,
        before: {
          fieldCount: current.fieldCount,
          groupSize: current.groupSize,
          matchMinutes: current.matchMinutes,
        },
        after: input,
      });

      if (fieldsChanged) {
        await emit(tx, categoryCode, "match.updated", {
          structure: true,
          reason: "fields.changed",
        });
      }

      if (rebuilt > 0) {
        return `Saqlandi · pleyoff qayta tuzildi, ${rebuilt} ta jamoa chiqdi`;
      }
      return fieldsChanged
        ? `Saqlandi · ${redistributed} ta oʻyin ${input.fieldCount} ta maydonga qayta taqsimlandi`
        : "Saqlandi";
    });

    revalidatePath("/admin/sozlamalar");
    revalidatePath("/admin");
    revalidatePath("/hakam");
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ============================================================
   Guruh → maydon
   ============================================================ */

/**
 * Guruhni maydonga biriktiradi: shu guruhning barcha boshlanmagan
 * oʻyinlari oʻsha maydonga koʻchadi. `null` — avtomatik taqsimlashga
 * qaytariladi.
 */
export async function setGroupField(
  rawGroupId: unknown,
  rawFieldNo: unknown,
): Promise<SettingsState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const groupId = toId(rawGroupId);
  if (groupId === null) return { ok: false, error: "Guruh topilmadi" };

  const fieldNo =
    rawFieldNo === null || rawFieldNo === undefined || rawFieldNo === ""
      ? null
      : toInt(rawFieldNo, { min: 1, max: 20 });
  if (rawFieldNo !== null && rawFieldNo !== undefined && rawFieldNo !== "" && fieldNo === null) {
    return { ok: false, error: "Maydon raqami notoʻgʻri" };
  }

  try {
    const message = await db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, groupId));
      if (!group) throw new Error("Guruh topilmadi");

      const [settings] = await tx
        .select({ fieldCount: schema.categories.fieldCount })
        .from(schema.categories)
        .where(eq(schema.categories.code, group.categoryCode));

      if (fieldNo !== null && fieldNo > (settings?.fieldCount ?? 1)) {
        throw new Error(
          `${fieldNo}-maydon yoʻq. Avval sozlamalarda maydonlar sonini oshiring.`,
        );
      }

      await tx
        .update(schema.groups)
        .set({ fieldNo })
        .where(eq(schema.groups.id, groupId));

      // Boshlanmagan oʻyinlarni koʻchiramiz; ketayotgani tegilmaydi
      const moved = await tx
        .update(schema.matches)
        .set({ fieldNo })
        .where(
          and(
            eq(schema.matches.groupId, groupId),
            eq(schema.matches.status, "pending"),
          ),
        )
        .returning({ id: schema.matches.id });

      if (fieldNo === null) {
        await assignFields(tx, group.categoryCode as keyof typeof CATEGORIES, settings?.fieldCount ?? 1);
      }

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "group.field",
        entity: "group",
        entityId: String(groupId),
        before: { fieldNo: group.fieldNo },
        after: { fieldNo },
      });

      await emit(tx, group.categoryCode, "match.updated", {
        structure: true,
        reason: "group.field",
      });

      return fieldNo === null
        ? `${group.name} guruh avtomatik taqsimlashga qaytarildi`
        : `${group.name} guruh → ${fieldNo}-maydon (${moved.length} ta oʻyin)`;
    });

    revalidatePath("/admin/sozlamalar");
    revalidatePath("/hakam");
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Bir necha guruhni bir vaqtda biriktirish (formadan). */
export async function saveGroupFields(
  _prev: SettingsState | null,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const entries: { groupId: number; fieldNo: number | null }[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^group-(\d+)$/.exec(key);
    if (!match) continue;
    const raw = String(value);
    entries.push({
      groupId: Number(match[1]),
      fieldNo: raw === "" || raw === "auto" ? null : Number(raw),
    });
  }

  if (entries.length === 0) return { ok: false, error: "Oʻzgarish yoʻq" };

  try {
    let categoryCode: string | null = null;

    await db.transaction(async (tx) => {
      const ids = entries.map((e) => e.groupId);
      const groups = await tx
        .select()
        .from(schema.groups)
        .where(inArray(schema.groups.id, ids));
      if (groups.length === 0) throw new Error("Guruhlar topilmadi");
      categoryCode = groups[0].categoryCode;

      const [settings] = await tx
        .select({ fieldCount: schema.categories.fieldCount })
        .from(schema.categories)
        .where(eq(schema.categories.code, categoryCode));
      const maxField = settings?.fieldCount ?? 1;

      for (const entry of entries) {
        if (entry.fieldNo !== null && (entry.fieldNo < 1 || entry.fieldNo > maxField)) {
          throw new Error(`${entry.fieldNo}-maydon mavjud emas (jami ${maxField} ta)`);
        }
        await tx
          .update(schema.groups)
          .set({ fieldNo: entry.fieldNo })
          .where(eq(schema.groups.id, entry.groupId));

        if (entry.fieldNo !== null) {
          await tx
            .update(schema.matches)
            .set({ fieldNo: entry.fieldNo })
            .where(
              and(
                eq(schema.matches.groupId, entry.groupId),
                eq(schema.matches.status, "pending"),
              ),
            );
        } else {
          await tx
            .update(schema.matches)
            .set({ fieldNo: null })
            .where(
              and(
                eq(schema.matches.groupId, entry.groupId),
                eq(schema.matches.status, "pending"),
              ),
            );
        }
      }

      await assignFields(tx, categoryCode as keyof typeof CATEGORIES, maxField);

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "group.fields.bulk",
        entity: "category",
        entityId: categoryCode,
        after: { entries },
      });

      await emit(tx, categoryCode, "match.updated", {
        structure: true,
        reason: "group.fields",
      });
    });

    revalidatePath("/admin/sozlamalar");
    revalidatePath("/hakam");
    return { ok: true, message: `${entries.length} ta guruh saqlandi` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
