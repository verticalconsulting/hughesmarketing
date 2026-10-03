import type { Service } from "@/lib/domain/integrations";

const CONNECTED_HEADINGS: [prefix: string, service: Service, key: string][] = [
  ["Google Analytics", "ga4", "property_id"],
  ["Google Search Console", "gsc", "site"],
  ["Google Ads", "google_ads", "customer_id"],
  ["GitHub", "github", "account"],
  ["Formspree", "formspree", "form_id"],
];
const SOCIAL: Record<string, Service> = { Facebook: "facebook", "Google Business Profile": "google_business_profile" };

export function parseIntegrations(md: string): { service: Service; identifiers: Record<string, string> }[] {
  const out: { service: Service; identifiers: Record<string, string> }[] = [];
  let current: { service: Service; identifiers: Record<string, string>; key: string } | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h3 = /^###\s+(.+?)\s*✅\s*$/.exec(line);
    if (h3) {
      const match = CONNECTED_HEADINGS.find(([prefix]) => h3[1].startsWith(prefix));
      current = match ? { service: match[1], identifiers: {}, key: match[2] } : null;
      if (current) out.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      current = null;
      continue;
    }
    const social = /^-\s+✅\s+\*\*(.+?)\*\*\s+—\s+connected/.exec(line);
    if (social) {
      const service = SOCIAL[social[1]];
      current = service ? { service, identifiers: {}, key: "handle" } : null;
      if (current) out.push(current);
      continue;
    }
    if (!current || current.identifiers[current.key]) continue;
    if (current.key === "handle") {
      const handle = /^-\s+(@.+?)\s+·/.exec(line);
      if (handle) current.identifiers.handle = handle[1].trim();
      continue;
    }
    const code = /`([^`]+)`/.exec(line);
    if (code) current.identifiers[current.key] = code[1];
  }
  return out.map(({ service, identifiers }) => ({ service, identifiers }));
}
