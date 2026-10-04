"use client";
import { ChevronRight, File, Folder } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "@/lib/domain/tree";
import { cn } from "@/lib/utils";

export function FileTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
  defaultOpen = false,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
  defaultOpen?: boolean;
}) {
  return (
    <ul>
      {nodes.map((n) => (
        <TreeItem key={n.path} node={n} selected={selected} onSelect={onSelect} depth={depth} defaultOpen={defaultOpen || (selected?.startsWith(`${n.path}/`) ?? false)} />
      ))}
    </ul>
  );
}

function TreeItem({ node, selected, onSelect, depth, defaultOpen }: { node: TreeNode; selected: string | null; onSelect: (p: string) => void; depth: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pad = { paddingLeft: `${depth * 12 + 4}px` };
  if (node.children) {
    return (
      <li>
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded py-0.5 text-left text-sm hover:bg-muted" style={pad} aria-expanded={open}>
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          <Folder className="size-4 text-funnel-referral" /> {node.name}
        </button>
        {open && <FileTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn("flex w-full items-center gap-1.5 rounded py-0.5 text-left text-sm hover:bg-muted", selected === node.path && "bg-accent text-accent-foreground")}
        style={{ paddingLeft: `${depth * 12 + 22}px` }}
      >
        <File className="size-3.5 text-muted-foreground" /> <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}
