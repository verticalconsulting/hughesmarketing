import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCrossClient } from "./cross-client";
import type { ClientPlan, Move } from "./types";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drive-layout-cross-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const quarantine = (from: string, to: string): Move => ({ from, to, reason: "duplicate", detail: "identical to x" });
const plan = (client: string, moves: Move[]): ClientPlan => ({ client, moves, conflicts: [], notes: [] });

describe("resolveCrossClient", () => {
  it("passes through plans with nothing wrong", async () => {
    const plans = [plan("A.com", [quarantine("A.com/x (1).md", "_Duplicates-to-delete/A.com-x-copy1.md")])];
    expect(await resolveCrossClient(root, plans)).toEqual(plans);
  });

  it("drops quarantine moves from different clients that would share one destination", async () => {
    const same = "_Duplicates-to-delete/Mercyhouseatc.com-vehicledonation-x-copy1.csv";
    const out = await resolveCrossClient(root, [
      plan("Mercyhouseatc.com", [quarantine("Mercyhouseatc.com/data/vehicledonation-x (1).csv", same)]),
      plan("Mercyhouseatc.com-vehicledonation", [quarantine("Mercyhouseatc.com-vehicledonation/data/x (1).csv", same)]),
    ]);
    expect(out.flatMap((p) => p.moves)).toEqual([]);
    expect(out.flatMap((p) => p.conflicts).map((c) => c.kind)).toEqual(["destination-exists", "destination-exists"]);
  });

  it("drops a quarantine move whose destination already exists on disk", async () => {
    await mkdir(path.join(root, "_Duplicates-to-delete"), { recursive: true });
    await writeFile(path.join(root, "_Duplicates-to-delete", "A.com-x-copy1.md"), "someone else's file");
    const out = await resolveCrossClient(root, [
      plan("A.com", [
        quarantine("A.com/x (1).md", "_Duplicates-to-delete/A.com-x-copy1.md"),
        { from: "A.com/seo/a.md", to: "A.com/resources/seo/a.md", reason: "topic-folder" },
      ]),
    ]);
    expect(out[0].moves.map((m) => m.reason)).toEqual(["topic-folder"]);
    expect(out[0].conflicts).toEqual([
      { path: "A.com/x (1).md", kind: "destination-exists", detail: "_Duplicates-to-delete/A.com-x-copy1.md already exists" },
    ]);
  });
});
