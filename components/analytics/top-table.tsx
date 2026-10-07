export function TopTable({
  title,
  rows,
  labelFor = (l) => l,
}: {
  title: string;
  rows: { label: string; clicks: number }[];
  labelFor?: (label: string) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="bg-muted p-2 text-left text-xs font-medium text-muted-foreground">{title}</caption>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="max-w-0 truncate p-2" title={r.label}>
                {labelFor(r.label)}
              </td>
              <td className="p-2 text-right tabular-nums">{new Intl.NumberFormat("en-US").format(r.clicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
