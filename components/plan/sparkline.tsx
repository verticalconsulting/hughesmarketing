"use client";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  return (
    <div className="h-10 w-28" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={values.map((v, i) => ({ i, v }))}>
          <YAxis domain={[0, 100]} hide />
          <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
