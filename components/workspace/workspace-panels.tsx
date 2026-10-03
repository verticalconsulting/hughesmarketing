"use client";
import { PanelRight } from "lucide-react";
import { Suspense, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { RightPane } from "./right-pane";

const DESKTOP_QUERY = "(min-width: 1024px)";

// Render exactly one layout. Showing both and hiding one with CSS would mount `children` twice,
// duplicating ids and test ids on every page.
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(DESKTOP_QUERY);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

export function WorkspacePanels({ brandSlug, children }: { brandSlug: string; children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  const [mobilePane, setMobilePane] = useState<"main" | "side">("main");

  if (isDesktop) {
    return (
      <div className="flex min-w-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="58%" minSize="35%">
            <main className="h-full overflow-y-auto">{children}</main>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="42%" minSize="25%" collapsible collapsedSize="0%">
            <Suspense fallback={null}>
              <RightPane brandSlug={brandSlug} />
            </Suspense>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex justify-end border-b p-1">
        <Button variant="ghost" size="sm" onClick={() => setMobilePane(mobilePane === "main" ? "side" : "main")}>
          <PanelRight className="size-4" /> {mobilePane === "main" ? "Files & tools" : "Back to workspace"}
        </Button>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {mobilePane === "main" ? (
          children
        ) : (
          <Suspense fallback={null}>
            <RightPane brandSlug={brandSlug} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
