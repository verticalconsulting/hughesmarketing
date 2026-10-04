"use server";
import { revalidatePath } from "next/cache";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { decidePlanItem } from "@/lib/services/plans";

export async function decidePlanItemAction(itemId: string, decision: "approve" | "decline") {
  const user = await requireUser();
  const r = await attempt(async () => {
    const item = await decidePlanItem({ itemId, decision, actor: actorFor(user) });
    return { status: item.status };
  });
  revalidatePath("/b", "layout");
  return r;
}
