import { Bell, FileText, LogOut, Pin } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityRow } from "@/lib/services/activity";
import type { SessionUser } from "@/lib/services/users";
import { ActivityList } from "./activity-list";
import { GetStarted } from "./get-started";

export function Sidebar({
  user,
  slug,
  activity,
  pending,
  steps,
}: {
  user: SessionUser;
  slug: string;
  activity: ActivityRow[];
  pending: number;
  steps: { key: string; label: string; done: boolean }[];
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="space-y-1 p-3">
        <h3 className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
          <Pin className="size-3" /> Pinned
        </h3>
        {["BRAND.md", "PLAN.md"].map((file) => (
          <Link key={file} href={`/b/${slug}/plan?pane=assets&file=${file}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
            <FileText className="size-4 text-primary" /> {file}
          </Link>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3">
        <ActivityList items={activity} />
      </ScrollArea>
      <div className="space-y-2 border-t p-3">
        <GetStarted steps={steps} />
        <Link href={`/b/${slug}/plan#approvals`} className="flex items-center justify-between rounded-md px-1 py-1 text-sm hover:bg-muted">
          <span className="flex items-center gap-2">
            <Bell className="size-4" /> Approvals
          </span>
          {pending > 0 && <span className="rounded-full bg-band-amber px-2 text-xs font-semibold text-white">{pending}</span>}
        </Link>
        <form action={signOut} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{user.name ?? user.email}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <button type="submit" aria-label="Sign out" className="rounded-md p-1 hover:bg-muted">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
