import Link from "next/link";
import { CATEGORY_LIST } from "@/lib/categories";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function CategoryNotFound() {
  return (
    <Card>
      <EmptyState
        title="Bunday yoʻnalish yoʻq"
        hint="Manzilda xatolik boʻlishi mumkin. Quyidagilardan birini tanlang."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {CATEGORY_LIST.map((cat) => (
              <Link
                key={cat.code}
                href={`/jonli/${cat.slug}`}
                className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        }
      />
    </Card>
  );
}
