export function RouteSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4" data-testid="route-skeleton" aria-busy="true">
      <p className="text-sm text-muted-foreground">Opening…</p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="h-40 rounded-lg bg-muted" />
      <div className="h-40 rounded-lg bg-muted" />
    </div>
  );
}
