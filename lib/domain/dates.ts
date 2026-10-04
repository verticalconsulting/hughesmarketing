const DAY = 24 * 60 * 60 * 1000;

export function groupByRecency<T extends { createdAt: Date }>(items: T[], now: Date) {
  // UTC day boundaries keep results identical on Vercel and on dev machines.
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const groups = { today: [] as T[], last7: [] as T[], last14: [] as T[], older: [] as T[] };
  for (const item of items) {
    const t = item.createdAt.getTime();
    if (t >= startOfToday.getTime()) groups.today.push(item);
    else if (t >= startOfToday.getTime() - 7 * DAY) groups.last7.push(item);
    else if (t >= startOfToday.getTime() - 14 * DAY) groups.last14.push(item);
    else groups.older.push(item);
  }
  return groups;
}
