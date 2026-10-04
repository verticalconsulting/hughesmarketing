"use client";
import { BarChart3, Bot, CalendarDays, ClipboardList, FileText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "agent", label: "Agent", icon: Bot },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "plan", label: "Plan", icon: ClipboardList },
  { key: "briefs", label: "Briefs", icon: FileText },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
] as const;

export function TabNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex items-center gap-1 rounded-full bg-muted p-1">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = pathname.startsWith(`/b/${slug}/${key}`);
        return (
          <Link
            key={key}
            href={`/b/${slug}/${key}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-card text-primary shadow-sm",
            )}
          >
            <Icon className="size-4" />
            <span className="hidden lg:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
