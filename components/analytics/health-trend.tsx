"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function HealthTrend({ points }: { points: { date: string; health: number }[] }) {
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No full audits yet.</p>;
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Line type="monotone" dataKey="health" name="Health" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
