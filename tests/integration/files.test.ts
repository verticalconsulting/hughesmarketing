import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand } from "@/lib/services/brands";
import { listFiles, listVersions, readFile, writeFile } from "@/lib/services/files";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";

describe("files service", () => {
  it("writes, reads, and versions a brand file", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    const v1 = await writeFile({ brandId: b.id, path: "BRAND.md", content: "# v1", actor });
    const v2 = await writeFile({ brandId: b.id, path: "BRAND.md", content: "# v2", actor });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await readFile({ brandId: b.id, path: "BRAND.md" })).text).toBe("# v2");
    expect((await readFile({ brandId: b.id, path: "BRAND.md", version: 1 })).text).toBe("# v1");
    expect((await listVersions({ brandId: b.id, path: "BRAND.md" })).map((v) => v.version)).toEqual([2, 1]);
  });

  it("skips identical content without creating a version", async () => {
    const actor = await createTestUser();
    await writeFile({ brandId: null, path: "skills/a/SKILL.md", content: "same", actor });
    const again = await writeFile({ brandId: null, path: "skills/a/SKILL.md", content: "same", actor });
    expect(again).toMatchObject({ version: 1, unchanged: true });
  });

  it("rejects a stale expected_version and reports the current version", async () => {
    const actor = await createTestUser();
    await writeFile({ brandId: null, path: "workspace/AGENTS.md", content: "a", actor });
    await writeFile({ brandId: null, path: "workspace/AGENTS.md", content: "b", actor });
    const err = await writeFile({ brandId: null, path: "workspace/AGENTS.md", content: "c", expectedVersion: 1, actor }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.details.currentVersion).toBe(2);
  });

  it("normalizes Windows paths and rejects traversal", async () => {
    const actor = await createTestUser();
    const r = await writeFile({ brandId: null, path: "skills\\b\\SKILL.md", content: "x", actor });
    expect(r.path).toBe("skills/b/SKILL.md");
    await expect(writeFile({ brandId: null, path: "../x.md", content: "x", actor })).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps brand and shared scopes separate and lists by prefix", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await writeFile({ brandId: b.id, path: "audits/2026-09-08-full-audit.md", content: "a", actor });
    await writeFile({ brandId: b.id, path: "PLAN.md", content: "p", actor });
    await writeFile({ brandId: null, path: "PLAN.md", content: "shared", actor });
    expect((await listFiles({ brandId: b.id, prefix: "audits/" })).map((f) => f.path)).toEqual(["audits/2026-09-08-full-audit.md"]);
    expect((await readFile({ brandId: null, path: "PLAN.md" })).text).toBe("shared");
  });

  it("returns binary files without text and suggests paths when missing", async () => {
    const actor = await createTestUser();
    await writeFile({ brandId: null, path: "data/x.xlsx", content: new Uint8Array([1, 2, 3]), actor });
    const f = await readFile({ brandId: null, path: "data/x.xlsx" });
    expect(f.text).toBeNull();
    expect(Array.from(f.bytes)).toEqual([1, 2, 3]);
    const err = await readFile({ brandId: null, path: "data/y.xlsx" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.details.suggestions).toContain("data/x.xlsx");
  });
});
