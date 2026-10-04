export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="m-4 rounded-xl border border-dashed p-6 text-center">
      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">Coming next</span>
      <h3 className="mt-2 font-display text-lg">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
