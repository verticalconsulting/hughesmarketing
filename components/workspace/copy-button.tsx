"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({
  text,
  label = "Copy",
  variant = "outline",
  size = "sm",
  toastMessage = "Copied — paste it into Claude Desktop",
}: {
  text: string;
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
  size?: "sm" | "default";
  toastMessage?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        toast.success(toastMessage);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {label}
    </Button>
  );
}
