import "server-only";
import { db, schema } from "@/lib/db";

/** Tranzaksiya ichidan ham, tashqarisidan ham chaqirsa bo'ladi. */
type Executor = Pick<typeof db, "insert">;

export type EventType =
  | "match.updated"
  | "match.reverted"
  | "run.saved"
  | "run.reverted"
  | "team.checked_in"
  | "draw.completed"
  | "draw.cancelled";

/**
 * Hodisani oqimga chiqaradi.
 *
 * MUHIM: yozuv o'zgarishi bilan BIR tranzaksiyada chaqirilsin. Shunda
 * tranzaksiya orqaga qaytsa hodisa ham chiqmaydi — tablo hech qachon
 * bazada yo'q natijani ko'rsatmaydi.
 */
export async function emit(
  exec: Executor,
  channel: string,
  type: EventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await exec.insert(schema.events).values({ channel, type, payload });
}
