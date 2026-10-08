import { describe, expect, it } from "vitest";
import { extractDate, localServicePagesDate, routeFile } from "./rules";
import type { FileEntry } from "./types";

const MTIME = Date.UTC(2026, 8, 24, 12); // 2026-09-24
const file = (path: string, over: Partial<FileEntry> = {}): FileEntry => ({
  path,
  sha256: `sha:${path}`,
  mtimeMs: MTIME,
  head: "",
  ...over,
});

describe("extractDate", () => {
  it("reads an ISO date from a Prepared line", () => {
    expect(extractDate("# T\n\n**Prepared:** 2026-09-24  ", MTIME)).toEqual({ date: "2026-09-24", source: "content" });
  });
  it("reads a long-form date", () => {
    expect(extractDate("**Prepared:** September 14, 2026  ", MTIME)).toEqual({ date: "2026-09-14", source: "content" });
  });
  it("reads an Audit date line", () => {
    expect(extractDate("- **Audit date:** 2026-09-10 UTC", MTIME)).toEqual({ date: "2026-09-10", source: "content" });
  });
  it("ignores dates on lines that are not about when the file was made", () => {
    expect(extractDate("Call us 2026-01-01", MTIME)).toEqual({ date: "2026-09-24", source: "mtime" });
  });
  it("falls back to the modified time", () => {
    expect(extractDate("", MTIME)).toEqual({ date: "2026-09-24", source: "mtime" });
  });
});

describe("localServicePagesDate", () => {
  it("prefers a date in the README head", () => {
    const files = [
      file("local-service-pages/README.md", { head: "# Local service pages — deliverables index (2026-10-03)" }),
      file("local-service-pages/keyword-to-page-map-2026-09-01.md"),
    ];
    expect(localServicePagesDate(files)).toBe("2026-10-03");
  });
  it("otherwise uses the latest date in a file name", () => {
    const files = [file("local-service-pages/a-2026-09-01.md"), file("local-service-pages/b-2026-10-03.md")];
    expect(localServicePagesDate(files)).toBe("2026-10-03");
  });
  it("is null when nothing is dated", () => {
    expect(localServicePagesDate([file("local-service-pages/a.md")])).toBeNull();
  });
});

describe("routeFile", () => {
  const ctx = { localServicePagesDate: "2026-10-03" };

  it("moves topic folders under resources/", () => {
    expect(routeFile(file("seo/a.md"), ctx)).toEqual({ to: "resources/seo/a.md", reason: "topic-folder" });
    expect(routeFile(file("paid-search/x/y.md"), ctx)).toEqual({ to: "resources/paid-search/x/y.md", reason: "topic-folder" });
  });

  it("leaves files that are already in place", () => {
    for (const p of ["resources/seo/a.md", "audits/a.md", "plans/a.md", "data/a.csv", "BRAND.md", "deliverables/a.md"]) {
      expect(routeFile(file(p), ctx)).toBeNull();
    }
  });

  it("splits local-service-pages", () => {
    expect(routeFile(file("local-service-pages/README.md"), ctx)?.to).toBe("resources/local-service-pages-2026-10-03/README.md");
    expect(routeFile(file("local-service-pages/brandon-gutter-installation-draft.md"), ctx)?.to).toBe(
      "content-drafts/brandon-gutter-installation-draft.md",
    );
    expect(routeFile(file("local-service-pages/keyword-to-page-map-2026-10-03.md"), ctx)?.to).toBe(
      "seo-page-map/keyword-to-page-map-2026-10-03.md",
    );
  });

  it("does not date the folder when no date was found", () => {
    expect(routeFile(file("local-service-pages/README.md"), { localServicePagesDate: null })?.to).toBe(
      "resources/local-service-pages/README.md",
    );
  });

  it("nests workflow results by workflow and date", () => {
    const name = "bda63dbc-fbf3-4ee3-af90-06d2bfb50f9c-social-content-calendar.md";
    const r = routeFile(file(`workflow-results/${name}`, { head: "**Prepared:** September 14, 2026" }), ctx);
    expect(r).toEqual({
      to: `resources/workflow-results/social-content-calendar/2026-09-14/${name}`,
      reason: "workflow-results",
      note: undefined,
    });
  });

  it("notes when the date came from the modified time", () => {
    const name = "8dbf7a47-d24a-4f73-887c-90fbfae82732-pre-launch-seo-audit-report.md";
    const r = routeFile(file(`workflow-results/${name}`), ctx);
    expect(r?.to).toBe(`resources/workflow-results/pre-launch-seo-audit-report/2026-09-24/${name}`);
    expect(r?.note).toContain("modified time");
  });

  it("keeps non-run-id workflow results flat under resources/workflow-results", () => {
    expect(routeFile(file("workflow-results/notes.md"), ctx)?.to).toBe("resources/workflow-results/notes.md");
  });
});
