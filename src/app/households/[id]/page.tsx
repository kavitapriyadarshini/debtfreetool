import { HouseholdOverview } from "@/components/household-overview";

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HouseholdOverview householdId={id} />;
}
