"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { listIntegrationsAction, saveIntegrationAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SERVICE_LABELS, SERVICES, type Service } from "@/lib/domain/integrations";
import { cn } from "@/lib/utils";

type Row = Awaited<ReturnType<typeof listIntegrationsAction>>[number];
const DOT = { connected: "bg-band-green", not_connected: "bg-muted-foreground/40", error: "bg-band-red" } as const;

export function IntegrationsPane({ brandSlug }: { brandSlug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [pending, start] = useTransition();
  const refresh = useCallback(async () => setRows(await listIntegrationsAction(brandSlug)), [brandSlug]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-2 p-3">
      <p className="text-xs text-muted-foreground">
        The agent pulls data with its own connectors; record each account here so it knows which property, site, or customer ID to use.
      </p>
      {SERVICES.filter((s) => s !== "other").map((service) => {
        const row = rows.find((r) => r.service === service);
        const status = row?.status ?? "not_connected";
        return (
          <div key={service} className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", DOT[status])} />
              <span className="flex-1 text-sm font-medium">{SERVICE_LABELS[service]}</span>
              <span className="text-xs text-muted-foreground">{status.replace("_", " ")}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(editing === service ? null : service)}>
                {editing === service ? "Close" : "Edit"}
              </Button>
            </div>
            {row && Object.keys(row.identifiers).length > 0 && (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                {Object.entries(row.identifiers).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {editing === service && (
              <form
                className="mt-2 space-y-2"
                action={(fd) =>
                  start(async () => {
                    const r = await saveIntegrationAction({
                      brandSlug,
                      service,
                      status: fd.get("status") as "connected" | "not_connected" | "error",
                      identifiersText: String(fd.get("identifiers") ?? ""),
                      notes: String(fd.get("notes") ?? ""),
                    });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`${SERVICE_LABELS[service]} saved`);
                    setEditing(null);
                    await refresh();
                  })
                }
              >
                <select name="status" defaultValue={status} className="w-full rounded border bg-background px-2 py-1 text-sm" aria-label="Status">
                  <option value="connected">Connected</option>
                  <option value="not_connected">Not connected</option>
                  <option value="error">Error</option>
                </select>
                <Textarea
                  name="identifiers"
                  aria-label="Identifiers"
                  placeholder={"property_id=515827425\nsite=sc-domain:example.com"}
                  defaultValue={Object.entries(row?.identifiers ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
                  className="font-mono text-xs"
                />
                <Textarea name="notes" aria-label="Notes" placeholder="Notes" defaultValue={row?.notes ?? ""} className="text-xs" />
                <Button size="sm" disabled={pending}>Save</Button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
