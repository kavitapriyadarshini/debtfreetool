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
  return <PresentRoom householdId={id} initialPlan={query.plan ?? ""} compared={query.compared ?? ""} />;
}
