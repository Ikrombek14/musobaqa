import { NextResponse } from "next/server";
import { getTabloData } from "@/server/queries/tablo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tablo maʼlumoti — bitta JSON.
 *
 * Ochiq: proyektor brauzerida sessiya boʻlmaydi. Shaxsiy maʼlumot
 * chiqmaydi — jamoa nomi, filial va natija, xolos.
 */
export async function GET() {
  try {
    const data = await getTabloData();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error("[tablo] xato:", (err as Error).message);
    return NextResponse.json({ error: "Maʼlumot olinmadi" }, { status: 500 });
  }
}
