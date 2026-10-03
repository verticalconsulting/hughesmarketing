"use client";
import { KeyRound, PlugZap } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createTokenAction, listTokensAction, revokeTokenAction } from "@/app/actions/tokens";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyButton } from "./copy-button";

type TokenRow = Awaited<ReturnType<typeof listTokensAction>>[number];

export function McpDialog({ origin }: { origin: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Claude Desktop");
  const [token, setToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [pending, start] = useTransition();
  const endpoint = `${origin}/api/mcp`;
  const shown = token ?? "<your token>";
  const config = JSON.stringify(
    {
      mcpServers: {
        "hughes-marketing": {
          command: "npx",
          args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: `Bearer ${shown}` },
        },
      },
    },
    null,
    2,
  );

  useEffect(() => {
    if (open) void listTokensAction().then(setTokens);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setToken(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlugZap className="size-4" /> MCP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Claude Desktop or OpenClaw</DialogTitle>
          <DialogDescription>
            Agents read and write this workspace through the MCP endpoint below. Each person creates their own token; revoke it any time.
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">1. Endpoint</h3>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{endpoint}</code>
            <CopyButton text={endpoint} toastMessage="Endpoint copied" />
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">2. Create a token</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await createTokenAction(name);
                if (!r.ok) return void toast.error(r.error);
                setToken(r.data.token);
                setTokens(await listTokensAction());
              });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" />
            <Button type="submit" disabled={pending}>
              <KeyRound className="size-4" /> Create token
            </Button>
          </form>
          {token && (
            <div className="rounded-md border border-band-amber bg-band-amber/10 p-2 text-xs">
              <p className="font-medium">Copy this token now — it is shown only once.</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate">{token}</code>
                <CopyButton text={token} toastMessage="Token copied" />
              </div>
            </div>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">3a. Claude Desktop</h3>
          <p className="text-xs text-muted-foreground">
            Settings → Developer → Edit Config, add this to <code>claude_desktop_config.json</code>, then restart Claude Desktop. Requires Node.js.
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{config}</pre>
          <CopyButton text={config} label="Copy config" toastMessage="Config copied" />
        </section>
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">3b. OpenClaw or another MCP client</h3>
          <p className="text-xs text-muted-foreground">
            Add a remote (Streamable HTTP) MCP server with URL <code>{endpoint}</code> and header <code>Authorization: Bearer {"<token>"}</code>.
          </p>
        </section>
        {tokens.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">Your tokens</h3>
            <ul className="divide-y rounded border text-xs">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 p-2">
                  <span className="flex-1">{t.name}</span>
                  <span className="text-muted-foreground">
                    {t.revokedAt ? "revoked" : t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}
                  </span>
                  {!t.revokedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-destructive"
                      onClick={() => start(async () => { await revokeTokenAction(t.id); setTokens(await listTokensAction()); })}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
