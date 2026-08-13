"use server";

import { revalidatePath } from "next/cache";
import { eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { emit } from "@/lib/realtime/emit";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeSearch } from "@/lib/format";
import { toId } from "@/lib/validate";

export type TeamActionState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const editSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(2, "Jamoa nomi kamida 2 belgi").max(120),
  school: z.string().trim().max(160).optional().or(z.literal("")),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  coach: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  members: z.string().trim().max(800).optional().or(z.literal("")),
});

/**
 * Jamoa maʼlumotini tahrirlash.
 *
 * Yoʻnalish va raqam OʻZGARMAYDI: jerebyovka oʻtkazilgandan keyin
 * jamoani boshqa yoʻnalishga koʻchirish jadvalni buzadi, raqam esa
 * check-in tartibining izi. Kerak boʻlsa check-in bekor qilinadi.
 */
export async function updateTeam(
  _prev: TeamActionState | null,
  formData: FormData,
): Promise<TeamActionState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Maʼlumot notoʻgʻri" };
  }
  const input = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, input.id));
      if (!current) throw new Error("Jamoa topilmadi");

      const members = (input.members ?? "")
        .split(/[,\n]/)
        .map((m) => m.trim())
        .filter(Boolean);

      await tx
        .update(schema.teams)
        .set({
          name: input.name,
          school: input.school || null,
          region: input.region || null,
          coach: input.coach || null,
          phone: input.phone || null,
          searchText: normalizeSearch(
            [input.name, input.school, input.coach, input.region, members.join(" ")]
              .filter(Boolean)
              .join(" "),
          ),
        })
        .where(eq(schema.teams.id, input.id));

      // Ishtirokchilar roʻyxati toʻliq almashtiriladi
      await tx.delete(schema.participants).where(eq(schema.participants.teamId, input.id));
      for (const member of members) {
        await tx.insert(schema.participants).values({ teamId: input.id, fullName: member });
      }

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "team.update",
        entity: "team",
        entityId: String(input.id),
        before: {
          name: current.name,
          school: current.school,
          coach: current.coach,
          phone: current.phone,
        },
        after: input,
      });

      await emit(tx, current.categoryCode, "team.checked_in", {
        teamId: input.id,
        number: current.number,
        name: input.name,
        edited: true,
      });
    });

    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    return { ok: true, message: `${input.name} saqlandi` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Check-in'ni bekor qilish.
 *
 * Raqam boʻshaydi, lekin hisoblagich orqaga qaytmaydi — R12 qayta
 * berilmaydi. Sabab: chop etilgan roʻyxat va suratlarda eski raqam qolgan
 * boʻlishi mumkin, uni boshqa jamoaga berish chalkashlik keltiradi.
 */
export async function undoCheckIn(rawTeamId: unknown): Promise<TeamActionState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Notoʻgʻri jamoa" };

  try {
    const message = await db.transaction(async (tx) => {
      const [team] = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId))
        .for("update");
      if (!team) throw new Error("Jamoa topilmadi");
      if (!team.checkedInAt) throw new Error("Bu jamoa hali check-in qilinmagan");

      const [inMatch] = await tx
        .select({ id: schema.matches.id })
        .from(schema.matches)
        .where(
          or(eq(schema.matches.teamAId, teamId), eq(schema.matches.teamBId, teamId)),
        )
        .limit(1);
      if (inMatch) {
        throw new Error(
          "Bu jamoa jadvalga kiritilgan — avval yoʻnalish jerebyovkasini bekor qiling.",
        );
      }

      await tx
        .update(schema.teams)
        .set({ number: null, numberSeq: null, checkedInAt: null, checkedInBy: null })
        .where(eq(schema.teams.id, teamId));

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "team.undo_checkin",
        entity: "team",
        entityId: String(teamId),
        before: { number: team.number, checkedInAt: team.checkedInAt },
      });

      await emit(tx, team.categoryCode, "team.checked_in", {
        teamId,
        number: null,
        name: team.name,
        undone: true,
      });

      return `${team.name} — check-in bekor qilindi (${team.number} raqami boʻshadi)`;
    });

    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    revalidatePath("/admin/checkin");
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Jamoani butunlay oʻchirish. Jadvalga tushgan jamoa oʻchirilmaydi. */
export async function deleteTeam(rawTeamId: unknown): Promise<TeamActionState> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { ok: false, error: "Ruxsat yoʻq" };

  const teamId = toId(rawTeamId);
  if (teamId === null) return { ok: false, error: "Notoʻgʻri jamoa" };

  try {
    const message = await db.transaction(async (tx) => {
      const [team] = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId));
      if (!team) throw new Error("Jamoa topilmadi");

      const [inMatch] = await tx
        .select({ id: schema.matches.id })
        .from(schema.matches)
        .where(or(eq(schema.matches.teamAId, teamId), eq(schema.matches.teamBId, teamId)))
        .limit(1);
      if (inMatch) {
        throw new Error("Jamoa jadvalga kiritilgan — oʻchirib boʻlmaydi.");
      }

      const [hasRun] = await tx
        .select({ id: schema.runs.id })
        .from(schema.runs)
        .where(eq(schema.runs.teamId, teamId))
        .limit(1);
      if (hasRun) {
        throw new Error("Jamoaning natijasi yozilgan — oʻchirib boʻlmaydi.");
      }

      await tx.insert(schema.auditLog).values({
        actor: admin.name,
        action: "team.delete",
        entity: "team",
        entityId: String(teamId),
        before: { name: team.name, number: team.number, categoryCode: team.categoryCode },
      });

      // participants / robots / group_teams — cascade
      await tx.delete(schema.teams).where(eq(schema.teams.id, teamId));

      await emit(tx, team.categoryCode, "team.checked_in", {
        teamId,
        deleted: true,
        name: team.name,
      });

      return `${team.name} oʻchirildi`;
    });

    revalidatePath("/admin/jamoalar");
    revalidatePath("/admin");
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Roʻyxatni Excel/Sheets ga koʻchirish uchun CSV matni. */
export async function exportTeamsCsv(): Promise<string> {
  await requireAdmin();

  const rows = await db
    .select({
      number: schema.teams.number,
      name: schema.teams.name,
      categoryCode: schema.teams.categoryCode,
      school: schema.teams.school,
      region: schema.teams.region,
      coach: schema.teams.coach,
      phone: schema.teams.phone,
      checkedInAt: schema.teams.checkedInAt,
      members: sql<string | null>`(
        select string_agg(p.full_name, '; ' order by p.id)
        from participants p where p.team_id = ${schema.teams.id}
      )`,
      groupName: schema.groups.name,
    })
    .from(schema.teams)
    .leftJoin(schema.groupTeams, eq(schema.groupTeams.teamId, schema.teams.id))
    .leftJoin(schema.groups, eq(schema.groups.id, schema.groupTeams.groupId))
    .orderBy(schema.teams.categoryCode, schema.teams.numberSeq);

  const header = [
    "Raqam",
    "Jamoa",
    "Yoʻnalish",
    "Guruh",
    "Maktab",
    "Viloyat",
    "Murabbiy",
    "Telefon",
    "Ishtirokchilar",
    "Check-in",
  ];

  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.number,
        row.name,
        row.categoryCode,
        row.groupName,
        row.school,
        row.region,
        row.coach,
        row.phone,
        row.members,
        row.checkedInAt ? new Date(row.checkedInAt).toISOString() : "",
      ]
        .map(escape)
        .join(","),
    ),
  ];

  // BOM — Excel UTF-8 ni toʻgʻri oʻqishi uchun
  return "﻿" + lines.join("\n");
}
