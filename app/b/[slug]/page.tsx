import { redirect } from "next/navigation";

export default async function BrandIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/b/${slug}/plan`);
}
