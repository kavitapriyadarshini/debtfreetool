import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ScreenPlaceholder({
  code,
  title,
  detail,
}: {
  code: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground">{code}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Placeholder</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
