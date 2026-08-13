export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Qaysi versiya ishlab turibdi.
 *
 * Deploy'dan keyin CI shu manzilga murojaat qilib, serverdagi commit
 * push qilinganiga MOS ekanini tekshiradi. Busiz «deploy muvaffaqiyatli»
 * deb koʻrinib, aslida eski konteyner ishlab turishi mumkin —
 * bir marta shunday boʻlgan va uni faqat qoʻlda tekshirganda topilgan.
 *
 * Maxfiy maʼlumot yoʻq: faqat commit SHA va yigʻilgan vaqt.
 */
export async function GET() {
  return Response.json(
    {
      sha: process.env.BUILD_SHA ?? "unknown",
      builtAt: process.env.BUILD_TIME ?? "unknown",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
