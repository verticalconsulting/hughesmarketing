import { describe, expect, it } from "vitest";
import { auditDateFromFilename, parseAuditMarkdown } from "./parse-audit";

const SAMPLE = `# Full marketing audit — Roofcoms

## AI Visibility

**Readiness:** 5/100

Roofcoms was mentioned in 0 of 9 tested answers.

**Top findings**

- Absent from all tested recommendations — Roofcoms did not appear in any of the 9 checks.

## GEO
**Readiness:** 86/100
**GEO audit:** status: ready / score: 86/100
## SEO
**Readiness:** 49/100
## Website & Content
**Readiness:** 41/100
- Page speed (fail) — Lighthouse performance 60/100
## Social Media
**Readiness:** 0/100
## Paid Ads
**Readiness:** 75/100
## Site content
## How It Works
**Readiness:** 99/100
`;

describe("parseAuditMarkdown", () => {
  it("extracts the six category readiness scores and first evidence bullet", () => {
    const r = parseAuditMarkdown(SAMPLE);
    expect(r.map((s) => [s.category, s.score])).toEqual([
      ["ai_visibility", 5],
      ["geo", 86],
      ["seo", 49],
      ["website_content", 41],
      ["social", 0],
      ["paid_ads", 75],
    ]);
    expect(r[0].evidence).toMatch(/^Absent from all tested recommendations/);
    expect(r[1].evidence).toBeNull();
  });

  it("returns nothing for documents without readiness sections", () => {
    expect(parseAuditMarkdown("# Ads audit\n\nNo scores here")).toEqual([]);
  });
});

describe("auditDateFromFilename", () => {
  it("reads date and optional time", () => {
    expect(auditDateFromFilename("2026-09-29-123919-full-audit.md")?.toISOString()).toBe("2026-09-29T12:39:19.000Z");
    expect(auditDateFromFilename("2026-09-24-light-audit.md")?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(auditDateFromFilename("report.md")).toBeNull();
  });
});
