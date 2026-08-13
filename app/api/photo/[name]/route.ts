import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Robot suratlari `public/` da emas — ular faqat tashkilotchilarga
 * koʻrinishi kerak. Shuning uchun fayl shu marshrut orqali, sessiya
 * tekshirilgandan keyin beriladi.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session.admin && !session.judge) {
    return new Response("Ruxsat yoʻq", { status: 403 });
  }

  const { name } = await params;

  // Papkadan chiqib ketishga urinishni bloklaymiz (../../etc/passwd)
  const safe = path.basename(name);
  if (safe !== name || !/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(safe)) {
    return new Response("Notoʻgʻri fayl nomi", { status: 400 });
  }

  try {
    const file = await readFile(path.join(path.resolve(env.UPLOAD_DIR), safe));
    const ext = path.extname(safe).toLowerCase();
    const type =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Topilmadi", { status: 404 });
  }
}
