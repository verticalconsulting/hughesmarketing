// Verifies a database is ready for the app: migrations seeded it and row-level security is on everywhere.
// Usage: DATABASE_URL=... pnpm tsx scripts/check-db.ts
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL.");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 1 });
let failed = 0;
const report = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

try {
  const [{ companies }] = await sql`select count(*)::int as companies from companies`;
  report(companies === 1, "exactly one company seeded", `found ${companies}`);
  const [{ configs }] = await sql`select count(*)::int as configs from scoring_config`;
  report(configs === 1, "exactly one scoring_config row seeded", `found ${configs}`);
  const open = await sql`select tablename from pg_tables where schemaname = 'public' and rowsecurity = false and tablename not like '\\_\\_%' order by tablename`;
  report(open.length === 0, "row-level security enabled on every public table", open.map((r) => r.tablename).join(", "));
} catch (e) {
  report(false, "database reachable and migrated", (e as Error).message);
} finally {
  await sql.end();
}
console.log(failed === 0 ? "\nDatabase is ready." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
