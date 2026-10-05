// Plans, applies, and undoes the Drive layout migration in
// docs/superpowers/specs/2026-10-05-phase0-drive-workspace-and-skills-design.md (section 3).
// Usage:
//   pnpm drive:restructure dry-run <AI-Assets-path> [--out report.md]
//   pnpm drive:restructure execute <AI-Assets-path> --manifest <file.json> [--include-optional] --yes
//   pnpm drive:restructure undo <manifest.json>
import { writeFile } from "node:fs/promises";
import { executeMoves, undoMoves } from "../lib/drive-layout/execute";
import { planClient } from "../lib/drive-layout/plan";
import { emptiedFolders, formatReport } from "../lib/drive-layout/report";
import { findStaleReferences, listClients, scanClient, type StaleReference } from "../lib/drive-layout/scan";
import type { ClientPlan, FileEntry } from "../lib/drive-layout/types";

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith("--")) positional.push(a);
  else if (a === "--out" || a === "--manifest") flags.set(a, rest[++i] ?? "");
  else flags.set(a, true);
}

function usage(): never {
  console.error(
    "Usage:\n  drive:restructure dry-run <AI-Assets-path> [--out file]\n" +
      "  drive:restructure execute <AI-Assets-path> --manifest <file> [--include-optional] --yes\n" +
      "  drive:restructure undo <manifest>",
  );
  process.exit(2);
}

async function planAll(root: string) {
  const plans: ClientPlan[] = [];
  const stale: Record<string, StaleReference[]> = {};
  const emptied: Record<string, string[]> = {};
  for (const client of await listClients(root)) {
    const files: FileEntry[] = await scanClient(root, client);
    const plan = planClient(client, files);
    plans.push(plan);
    stale[client] = plan.moves.length ? await findStaleReferences(root, client, plan.moves) : [];
    emptied[client] = emptiedFolders(files, plan.moves, client);
  }
  return { plans, stale, emptied };
}

async function main() {
  if (command === "dry-run") {
    const root = positional[0] ?? usage();
    const report = formatReport({ generatedAt: new Date().toISOString().slice(0, 10), ...(await planAll(root)) });
    const out = flags.get("--out");
    if (typeof out === "string" && out) {
      await writeFile(out, report, "utf8");
      console.log(`Report written to ${out}`);
    } else {
      console.log(report);
    }
    return;
  }

  if (command === "execute") {
    const root = positional[0] ?? usage();
    const manifest = flags.get("--manifest");
    if (typeof manifest !== "string" || !manifest) usage();
    if (flags.get("--yes") !== true) {
      console.error("Refusing to move files without --yes. Run dry-run first and review the report.");
      process.exit(2);
    }
    const { plans } = await planAll(root);
    const moves = plans.flatMap((p) => p.moves);
    const includeOptional = flags.get("--include-optional") === true;
    const { moved } = await executeMoves(root, moves, manifest, { includeOptional });
    console.log(`Moved ${moved} file(s). Manifest: ${manifest}. Undo with: pnpm drive:restructure undo ${manifest}`);
    return;
  }

  if (command === "undo") {
    const manifest = positional[0] ?? usage();
    const { restored, skipped } = await undoMoves(manifest);
    console.log(`Restored ${restored} file(s).`);
    for (const s of skipped) console.warn(`Skipped: ${s}`);
    if (skipped.length) process.exit(1);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
