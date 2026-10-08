"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const TIP = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 };

export function TrafficChart({ points }: { points: Record<string, string | number>[] }) {
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No traffic recorded in this range.</p>;
  return (
    <div className="h-64" data-testid="traffic-chart">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} />
          <YAxis tick={AXIS} />
          <Tooltip contentStyle={TIP} />
          <Legend />
          <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#4F46E5" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="users" name="Users (user-days)" stroke="#0D9488" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="key_events" name="Key events" stroke="#D97706" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
