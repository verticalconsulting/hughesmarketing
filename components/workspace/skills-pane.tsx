"use client";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { listSkillsAction } from "@/app/actions/files";
import { Input } from "@/components/ui/input";

export function SkillsPane({ onOpen }: { onOpen: (path: string) => void }) {
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    void listSkillsAction().then(setSkills);
  }, []);
  const shown = skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2 p-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${skills.length} skills…`} className="h-8" />
      <ul className="space-y-1">
        {shown.map((s) => (
          <li key={s.name}>
            <button type="button" onClick={() => onOpen(`skills/${s.name}/SKILL.md`)} className="w-full rounded-md p-2 text-left hover:bg-muted">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-3.5 text-primary" /> {s.name}
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{s.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
