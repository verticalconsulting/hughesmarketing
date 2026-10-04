import { redirect } from "next/navigation";
import { AddBrandDialog } from "@/components/workspace/add-brand-dialog";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/services/brands";

export default async function Home() {
  await requireUser();
  const brands = await listBrands();
  if (brands.length > 0) redirect(`/b/${brands[0].slug}/plan`);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="font-display text-3xl">Add your first brand</h1>
        <p className="text-muted-foreground">
          Add a client brand, then connect Claude Desktop to onboard it, run an audit, and build a plan.
        </p>
        <AddBrandDialog trigger={<Button size="lg">Add brand</Button>} />
      </div>
    </main>
  );
}
