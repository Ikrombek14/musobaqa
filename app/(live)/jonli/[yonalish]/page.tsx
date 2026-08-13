import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { categoryBySlug, CATEGORY_LIST } from "@/lib/categories";
import { getBoardData } from "@/server/queries/competition";
import { LiveBoard } from "@/components/live/live-board";

// Natijalar jonli — hech qachon keshlanmaydi
export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return CATEGORY_LIST.map((cat) => ({ yonalish: cat.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/jonli/[yonalish]">): Promise<Metadata> {
  const { yonalish } = await params;
  const category = categoryBySlug(yonalish);
  if (!category) return { title: "Topilmadi" };
  return {
    title: `${category.name} — jonli natijalar`,
    description: `${category.name} yoʻnalishi boʻyicha jonli natijalar va jadval.`,
  };
}

export default async function CategoryLivePage({ params }: PageProps<"/jonli/[yonalish]">) {
  const { yonalish } = await params;
  const category = categoryBySlug(yonalish);
  if (!category) notFound();

  const data = await getBoardData(category.code);

  return <LiveBoard data={data} />;
}
