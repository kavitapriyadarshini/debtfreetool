import { Workspace } from "@/components/workspace";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <Workspace householdId={id} compare={query.compare ?? ""} />;
}
