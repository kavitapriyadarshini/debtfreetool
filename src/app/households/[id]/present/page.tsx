import { redirect } from "next/navigation";
import { PresentRoom } from "@/components/present-room";

export default async function PresentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string; compared?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (query.compared) {
    const plan = query.plan ? `?plan=${encodeURIComponent(query.plan)}` : "";
    redirect(`/households/${id}/present${plan}`);
  }
  return <PresentRoom householdId={id} initialPlan={query.plan ?? ""} />;
}
