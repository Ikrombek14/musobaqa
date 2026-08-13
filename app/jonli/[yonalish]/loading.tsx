export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-9 w-64 animate-pulse rounded-md bg-[var(--surface)]" />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface)]"
          />
        ))}
      </div>
    </div>
  );
}
