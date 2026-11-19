import { HouseholdOverview } from "@/components/household-overview";
import { overviewTab } from "@/lib/household-overview";

export default async function HouseholdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab = overviewTab(query.tab);
  return <HouseholdOverview householdId={id} tab={tab} tabInUrl={query.tab === tab} />;
}
