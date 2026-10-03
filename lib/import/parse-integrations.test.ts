import { describe, expect, it } from "vitest";
import { parseIntegrations } from "./parse-integrations";

const MD = `## Social platforms

- ⚪ LinkedIn → [connect](https://example.com)
- ✅ **Facebook** — connected
    - @SuperThriftPearl  ·  id: 6abb53cd884bd7461851ab33
- ✅ **Google Business Profile** — connected
    - @SuperThrift Pearl  ·  id: 6aaad4498d284ffb21099ae1

## Connected

### Google Analytics ✅
- Properties:
  - \`515827425\` — SuperThrift
### Google Search Console ✅
- Sites:
  - \`sc-domain:superthriftdeals.org\`
### GitHub ✅
- Account: \`verticalconsulting\`
- Repos:
  - \`verticalconsulting/www-verticalconsulting-net\` (default: main)
### Google Ads ✅
- Ad accounts:
  - \`6690622662\` — SuperThrift Pearl
### Gmail ✅
- Connected
### Formspree: Formspree (xzdekbzd) (xzdekbzd) ✅
- Form ID: \`xzdekbzd\`
`;

describe("parseIntegrations", () => {
  it("maps connected services to identifiers", () => {
    expect(parseIntegrations(MD)).toEqual([
      { service: "facebook", identifiers: { handle: "@SuperThriftPearl" } },
      { service: "google_business_profile", identifiers: { handle: "@SuperThrift Pearl" } },
      { service: "ga4", identifiers: { property_id: "515827425" } },
      { service: "gsc", identifiers: { site: "sc-domain:superthriftdeals.org" } },
      { service: "github", identifiers: { account: "verticalconsulting" } },
      { service: "google_ads", identifiers: { customer_id: "6690622662" } },
      { service: "formspree", identifiers: { form_id: "xzdekbzd" } },
    ]);
  });
});
