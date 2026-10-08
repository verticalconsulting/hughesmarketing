import { access } from "node:fs/promises";
import path from "node:path";
import type { ClientPlan, Conflict, Move } from "./types";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Quarantine targets live outside every client folder, so a per-client plan cannot see them collide. Drops a
 * quarantine move when another client plans the same destination, or when something already sits there on disk,
 * and reports it as a conflict so the rest of the plan can still run.
 */
export async function resolveCrossClient(root: string, plans: ClientPlan[]): Promise<ClientPlan[]> {
  const key = (p: string) => p.toLowerCase();
  const isQuarantine = (m: Move) => m.reason === "duplicate";

  const sources = new Map<string, string[]>();
  for (const plan of plans) {
    for (const m of plan.moves.filter(isQuarantine)) sources.set(key(m.to), [...(sources.get(key(m.to)) ?? []), m.from]);
  }

  const out: ClientPlan[] = [];
  for (const plan of plans) {
    const moves: Move[] = [];
    const conflicts: Conflict[] = [...plan.conflicts];
    for (const m of plan.moves) {
      if (!isQuarantine(m)) {
        moves.push(m);
        continue;
      }
      const sharers = sources.get(key(m.to)) ?? [];
      if (sharers.length > 1) {
        const others = sharers.filter((s) => s !== m.from).join(", ");
        conflicts.push({ path: m.from, kind: "destination-exists", detail: `${m.to} is also the destination of ${others}` });
      } else if (await exists(path.join(root, ...m.to.split("/")))) {
        conflicts.push({ path: m.from, kind: "destination-exists", detail: `${m.to} already exists` });
      } else {
        moves.push(m);
      }
    }
    out.push({ ...plan, moves, conflicts });
  }
  return out;
}
