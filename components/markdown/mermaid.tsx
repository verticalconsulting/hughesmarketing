"use client";
import { useEffect, useId, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const out = await mermaid.render(id, chart);
        if (!cancelled) setSvg(out.svg);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);
  if (error) return <pre className="text-xs text-destructive">{`Diagram error: ${error}\n\n${chart}`}</pre>;
  if (!svg) return <div className="text-xs text-muted-foreground">Rendering diagram…</div>;
  return <div className="my-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
