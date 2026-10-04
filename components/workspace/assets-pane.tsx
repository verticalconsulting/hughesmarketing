"use client";
import { Download, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { listFilesAction, listVersionsAction, readFileAction, uploadFileAction } from "@/app/actions/files";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildTree } from "@/lib/domain/tree";
import type { FileInfo } from "@/lib/services/files";
import { FileTree } from "./file-tree";

type Scope = "brand" | "shared";
type Preview = { path: string; version: number; contentType: string; size: number; text: string | null; downloadUrl: string };

export function AssetsPane({
  brandSlug,
  scope,
  file,
  onOpen,
}: {
  brandSlug: string;
  scope: Scope;
  file: string | null;
  onOpen: (scope: Scope, path: string) => void;
}) {
  const [brandFiles, setBrandFiles] = useState<FileInfo[]>([]);
  const [sharedFiles, setSharedFiles] = useState<FileInfo[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<{ version: number; author: string; createdAt: Date }[]>([]);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const slugFor = useCallback((s: Scope) => (s === "brand" ? brandSlug : null), [brandSlug]);

  const refresh = useCallback(async () => {
    const [b, s] = await Promise.all([listFilesAction(brandSlug), listFilesAction(null)]);
    setBrandFiles(b);
    setSharedFiles(s);
  }, [brandSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const load = useCallback(
    async (version?: number) => {
      if (!file) return;
      const r = await readFileAction(slugFor(scope), file, version);
      if (!r.ok) {
        setPreview(null);
        setError(r.error);
        return;
      }
      setError(null);
      setPreview(r.data);
      setVersions(await listVersionsAction(slugFor(scope), file));
    },
    [file, scope, slugFor],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const brandTree = useMemo(() => buildTree(brandFiles.map((f) => f.path)), [brandFiles]);
  const sharedTree = useMemo(() => buildTree(sharedFiles.map((f) => f.path)), [sharedFiles]);

  const upload = (formData: FormData) =>
    start(async () => {
      formData.set("brandSlug", scope === "brand" ? brandSlug : "");
      const r = await uploadFileAction(formData);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Uploaded ${r.data.path} (v${r.data.version})`);
      await refresh();
      onOpen(scope, r.data.path);
    });

  const isMarkdown = preview?.path.toLowerCase().endsWith(".md");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[42%] min-h-32 overflow-y-auto border-b p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Files</span>
          <form action={upload} className="flex items-center gap-1">
            <Input name="folder" placeholder="folder" className="h-7 w-24 text-xs" aria-label="Upload folder" />
            <Input name="file" type="file" className="h-7 w-40 text-xs" aria-label="File to upload" />
            <Button size="sm" className="h-7" disabled={pending} aria-label="Upload">
              <Upload className="size-3.5" />
            </Button>
          </form>
        </div>
        <details open>
          <summary className="cursor-pointer text-sm font-medium">Brand files</summary>
          <FileTree nodes={brandTree} selected={scope === "brand" ? file : null} onSelect={(p) => onOpen("brand", p)} />
        </details>
        <details open={scope === "shared"}>
          <summary className="cursor-pointer text-sm font-medium">Shared (skills, workspace)</summary>
          <FileTree nodes={sharedTree} selected={scope === "shared" ? file : null} onSelect={(p) => onOpen("shared", p)} />
        </details>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!file && <p className="p-4 text-sm text-muted-foreground">Select a file to preview it.</p>}
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {preview && (
          <>
            <div className="sticky top-0 flex flex-wrap items-center gap-2 border-b bg-card/95 px-3 py-2 text-xs backdrop-blur">
              <span className="min-w-0 flex-1 truncate font-medium">{preview.path}</span>
              <select
                aria-label="Version"
                className="rounded border bg-background px-1 py-0.5"
                value={preview.version}
                onChange={(e) => void load(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} · {v.author} · {new Date(v.createdAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
              {preview.text !== null && isMarkdown && (
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setRaw(!raw)}>
                  {raw ? "Preview" : "Raw"}
                </Button>
              )}
              <a href={preview.downloadUrl} className="flex items-center gap-1 text-primary hover:underline" download>
                <Download className="size-3.5" /> Download
              </a>
            </div>
            <div className="p-4">
              {preview.text === null ? (
                <p className="text-sm text-muted-foreground">
                  {preview.contentType} · {(preview.size / 1024).toFixed(1)} KB — no inline preview. Use Download.
                </p>
              ) : isMarkdown && !raw ? (
                <MarkdownView source={preview.text} />
              ) : (
                <pre className="whitespace-pre-wrap break-words text-xs">{preview.text}</pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
