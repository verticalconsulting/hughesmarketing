"use client";
import { useActionState, useState } from "react";
import { createBrandAction } from "@/app/actions/brands";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddBrandDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const [state, action, pending] = useActionState(createBrandAction, {});
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a brand</DialogTitle>
          <DialogDescription>Create the client workspace. Onboarding happens next, through Claude Desktop.</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input id="brand-name" name="name" required placeholder="SuperThrift" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-domain">Website</Label>
            <Input id="brand-domain" name="domain" placeholder="superthriftdeals.org" />
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating…" : "Create brand"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
