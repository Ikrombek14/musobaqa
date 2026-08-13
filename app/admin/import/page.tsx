import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { ImportScreen } from "@/components/admin/import-screen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Excel import" };

export default async function ImportPage() {
  const session = await getSession();
  if (!session.admin) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Excel import</h1>
        <p className="mt-1 max-w-[75ch] text-sm text-[var(--text-muted)]">
          Faylni yuklang, ustunlarni tasdiqlang, koʻrib chiqing va qoʻshing.
          Jamoalarga raqam <strong>berilmaydi</strong> — raqam check-in paytida
          beriladi, shunda kelmagan jamoa raqamni band qilmaydi. Bir xil nomli
          jamoa allaqachon boʻlsa oʻtkazib yuboriladi, shuning uchun importni
          qayta bosish xavfsiz.
        </p>
      </div>

      <ImportScreen />
    </div>
  );
}
