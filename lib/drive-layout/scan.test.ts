import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findStaleReferences, listClients, scanClient } from "./scan";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drive-layout-scan-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, content: string) {
  const full = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

describe("listClients", () => {
  it("skips shared, personal, duplicate, and dot folders and loose files", async () => {
    for (const p of ["Acme.com/a.md", "Beta.org/b.md", "Hughes Files/x.md", "_Personal-Automations/p.md", "_Duplicates-to-delete/d.md", ".claude/s.json"]) {
      await put(p, "x");
    }
    await put("README.md", "x");
    expect(await listClients(root)).toEqual(["Acme.com", "Beta.org"]);
  });
});

describe("scanClient", () => {
  it("returns sorted entries with hash and head, ignoring desktop.ini and dot files", async () => {
    await put("Acme.com/seo/a.md", "line1\nline2\n");
    await put("Acme.com/data/b.csv", "x,y\n1,2\n");
    await put("Acme.com/desktop.ini", "junk");
    await put("Acme.com/.hidden/z.md", "junk");
    const entries = await scanClient(root, "Acme.com");
    expect(entries.map((e) => e.path)).toEqual(["data/b.csv", "seo/a.md"]);
    const a = entries.find((e) => e.path === "seo/a.md")!;
    expect(a.sha256).toBe(createHash("sha256").update("line1\nline2\n").digest("hex"));
    expect(a.head).toBe("line1\nline2\n");
    expect(a.mtimeMs).toBeGreaterThan(0);
  });

  it("leaves head empty for non-text files", async () => {
    await put("Acme.com/data/p.png", "binary");
    expect((await scanClient(root, "Acme.com"))[0].head).toBe("");
  });
});

describe("findStaleReferences", () => {
  it("flags files that mention an old path but not the new one", async () => {
    await put("Acme.com/seo/a.md", "body");
    await put("Acme.com/deliverables/note.md", "See seo/a.md and resources/seo/a.md");
    await put("Acme.com/deliverables/ok.md", "See resources/seo/a.md and https://acme.com/seo/");
    const stale = await findStaleReferences(root, "Acme.com", [
      { from: "Acme.com/seo/a.md", to: "Acme.com/resources/seo/a.md", reason: "topic-folder" },
    ]);
    expect(stale).toEqual([{ file: "Acme.com/deliverables/note.md", mentions: ["seo/", "seo/a.md"] }]);
  });
});
