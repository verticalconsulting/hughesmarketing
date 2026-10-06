type Props = {
  label: string;
  integration?: { status: string; lastSyncedAt: Date | null; lastSyncError: string | null };
};

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function SyncNote({ label, integration }: Props) {
  if (!integration || integration.status !== "connected") {
    return <p className="text-sm text-muted-foreground">Connect {label} on the Integrations pane to see this section.</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">
        {integration.lastSyncedAt ? `Last synced ${stamp(integration.lastSyncedAt)}` : "Never synced. Use Sync now on the Integrations pane."}
      </p>
      {integration.lastSyncError && (
        <p role="alert" className="text-band-red">
          {integration.lastSyncError}
        </p>
      )}
    </div>
  );
}
