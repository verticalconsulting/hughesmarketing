import Link from "next/link";
import { cn } from "@/lib/utils";

export function RangeToggle({ slug, range }: { slug: string; range: 30 | 90 }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Date range">
      {([30, 90] as const).map((d) => (
        <Link
          key={d}
          href={`/b/${slug}/analytics?range=${d}`}
          aria-current={range === d ? "true" : undefined}
          className={cn("rounded px-2 py-1", range === d ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {d} days
        </Link>
      ))}
    </div>
  );
}
