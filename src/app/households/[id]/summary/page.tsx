import { SummarySheet } from "@/components/summary-sheet";

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SummarySheet householdId={id} />;
}
