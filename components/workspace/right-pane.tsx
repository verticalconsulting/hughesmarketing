"use client";
export function RightPane({ brandSlug }: { brandSlug: string }) {
  return <div className="p-4 text-sm text-muted-foreground">Files for {brandSlug} load here.</div>;
}
