import { CheckCircle2, Circle } from "lucide-react";

export function GetStarted({ steps }: { steps: { key: string; label: string; done: boolean }[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <details className="rounded-lg border bg-card p-2 text-sm" open={done < steps.length}>
      <summary className="flex cursor-pointer items-center justify-between font-medium">
        Get started <span className="text-xs text-muted-foreground">{done}/{steps.length}</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            {s.done ? <CheckCircle2 className="size-4 text-band-green" /> : <Circle className="size-4 text-muted-foreground" />}
            <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
