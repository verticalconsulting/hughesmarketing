"use client";
import { ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BrandSummary } from "@/lib/services/brands";
import { AddBrandDialog } from "./add-brand-dialog";

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold text-white" style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function BrandSwitcher({ brands, current }: { brands: BrandSummary[]; current: BrandSummary }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-2 font-medium">
            <Avatar name={current.name} color={current.color} />
            <span className="max-w-40 truncate">{current.name}</span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Brands</DropdownMenuLabel>
          {brands.map((b) => (
            <DropdownMenuItem key={b.id} asChild>
              <Link href={`/b/${b.slug}/plan`} className="flex items-center gap-2">
                <Avatar name={b.name} color={b.color} />
                <span className="flex-1 truncate">{b.name}</span>
                <span className="text-xs text-muted-foreground">{b.health ?? "—"}</span>
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus className="size-4" /> Add brand
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddBrandDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
