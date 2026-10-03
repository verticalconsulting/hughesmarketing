import { sql } from "@/lib/data/db";
import { getEnv } from "@/lib/env";
import { runImport } from "@/lib/import/run-import";
import { upsertUserByEmail } from "@/lib/services/users";

const root = process.argv[2];
if (!root) {
  console.error('Usage: pnpm import:ai-assets "C:/Users/you/Google Drive Streaming/My Drive/AI Assets"');
  process.exit(2);
}
const email = process.env.IMPORT_AS_EMAIL ?? getEnv().ALLOWED_EMAILS[0];
if (!email) {
  console.error("Set IMPORT_AS_EMAIL or ALLOWED_EMAILS so imported changes have an author.");
  process.exit(2);
}
const user = await upsertUserByEmail({ email });
const report = await runImport(root, { kind: "user", userId: user.id, label: `import (${email})` });
console.log(`Brands: ${report.brands.join(", ")}`);
console.log(`Files written: ${report.written}, unchanged: ${report.unchanged}`);
console.log(`Audits: ${report.audits}, plans: ${report.plans}, integrations: ${report.integrations}`);
console.log(`Skipped: ${report.skipped.join(", ") || "none"}`);
for (const f of report.failed) console.error(`FAILED ${f.path}: ${f.error}`);
await sql.end();
process.exit(report.failed.length > 0 ? 1 : 0);
