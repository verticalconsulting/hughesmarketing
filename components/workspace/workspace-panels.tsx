"use client";
import { PanelRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { RightPane } from "./right-pane";

export function WorkspacePanels({ brandSlug, children }: { brandSlug: string; children: React.ReactNode }) {
  const [mobilePane, setMobilePane] = useState<"main" | "side">("main");
  return (
    <>
      <div className="hidden min-w-0 flex-1 lg:flex">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="58%" minSize="35%">
            <main className="h-full overflow-y-auto">{children}</main>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="42%" minSize="25%" collapsible collapsedSize="0%">
            <RightPane brandSlug={brandSlug} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <div className="flex min-w-0 flex-1 flex-col lg:hidden">
        <div className="flex justify-end border-b p-1">
          <Button variant="ghost" size="sm" onClick={() => setMobilePane(mobilePane === "main" ? "side" : "main")}>
            <PanelRight className="size-4" /> {mobilePane === "main" ? "Files & tools" : "Back to workspace"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{mobilePane === "main" ? children : <RightPane brandSlug={brandSlug} />}</div>
      </div>
    </>
  );
}
