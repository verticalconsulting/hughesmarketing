"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/domain/scoring";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export function CategoryTrend({ points }: { points: Record<string, number | string>[] }) {
  if (points.length === 0) return null;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {CATEGORIES.map((c, i) => (
            <Line key={c} type="monotone" dataKey={c} name={CATEGORY_LABELS[c]} stroke={COLORS[i]} strokeWidth={2} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
