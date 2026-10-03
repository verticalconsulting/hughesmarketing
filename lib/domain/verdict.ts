export type Direction = "up" | "down";
export type Verdict = "pending" | "positive" | "neutral" | "negative";
export const DEFAULT_THRESHOLD_PCT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeVerdict(
  t: { baselineValue: number; baselineAt: Date; direction: Direction; windowDays: number; thresholdPct: number },
  checkins: { value: number; observedAt: Date }[],
  now: Date,
): { verdict: Verdict; latest: number | null; changePct: number | null; changeAbs: number | null; windowEndsAt: Date } {
  const windowEndsAt = new Date(t.baselineAt.getTime() + t.windowDays * DAY_MS);
  if (checkins.length === 0) {
    return { verdict: "pending", latest: null, changePct: null, changeAbs: null, windowEndsAt };
  }
  const sorted = [...checkins].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  const latestCheckin = sorted[0];
  const latest = latestCheckin.value;
  const changeAbs = latest - t.baselineValue;
  const changePct = t.baselineValue === 0 ? null : (changeAbs / Math.abs(t.baselineValue)) * 100;
  const sign = t.direction === "up" ? 1 : -1;

  const windowElapsed = now.getTime() >= windowEndsAt.getTime();
  const hasLateCheckin = latestCheckin.observedAt.getTime() >= windowEndsAt.getTime();
  if (!windowElapsed || !hasLateCheckin) {
    return { verdict: "pending", latest, changePct, changeAbs, windowEndsAt };
  }

  let verdict: Verdict;
  if (changePct === null) {
    const signed = sign * changeAbs;
    verdict = signed >= 1 ? "positive" : signed <= -1 ? "negative" : "neutral";
  } else {
    const signed = sign * changePct;
    verdict = signed >= t.thresholdPct ? "positive" : signed <= -t.thresholdPct ? "negative" : "neutral";
  }
  return { verdict, latest, changePct, changeAbs, windowEndsAt };
}
