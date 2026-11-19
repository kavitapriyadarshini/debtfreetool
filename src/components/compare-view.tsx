"use client";

import { memo, startTransition, useEffect, useMemo, useState } from "react";
import { ActionBar, actionBarOffset } from "@/components/action-bar";
import { Profile } from "@/components/profile";
import { PaymentDot } from "@/components/payment-dot";
import { SavingsText } from "@/components/savings-text";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { compareFor, nextComparison, type CompareColumn, type CompareView } from "@/lib/compare";
import { formatMoney } from "@/lib/format";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const SERIES_COLOR = ["#1d4e89", "#5c6b7a", "#8b98a5", "#16324f", "#6d8cae", "#2f4558", "#a8b4c0", "#3d5a73"];

export function CompareView({
  householdId,
  householdName,
  selectedIds,
  notice = false,
}: {
  householdId: string;
  householdName: string;
  selectedIds: string[];
  notice?: boolean;
}) {
  const router = useRouter();
  const cases = useDemoStore((state) => state.cases);
  const scenarios = useDemoStore((state) => state.scenarios);
  const overrides = useDemoStore((state) => state.caseOverrides);
  const extraPayments = useDemoStore((state) => state.extraPayments);
  const customLoans = useDemoStore((state) => state.customLoans);
  const startCase = useDemoStore((state) => state.startCase);
  const addScenario = useDemoStore((state) => state.addScenario);
  const recommend = useDemoStore((state) => state.recommend);

  const caseRow = useMemo(() => {
    const matches = cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1] ?? null;
  }, [cases, householdId]);

  const kept = useKeptResult(
    () =>
      compareFor(
        householdId,
        caseRow?.case_id ?? null,
        { overrides, extraPayments, customLoans },
        scenarios,
        selectedIds,
      ),
    [householdId, caseRow?.case_id, overrides, extraPayments, customLoans, scenarios, selectedIds],
  );
  const view = kept.value;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<CompareColumn | null>(null);
  const [shown, setShown] = useState<CompareColumn | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [replaced, setReplaced] = useState<string | null>(null);

  const active = view?.columns.find((column) => column.id === selectedId) ?? null;
  const hasRecommendation = caseRow?.recommended_scenario_id != null;
  const selectedIsRecommended =
    active != null && active.savedScenarioId != null && active.savedScenarioId === caseRow?.recommended_scenario_id;

  useEffect(() => {
    router.prefetch(`/households/${householdId}/present`);
    router.prefetch(`/households/${householdId}/summary`);
  }, [router, householdId]);

  function back() {
    router.push(`/households/${householdId}/workspace`);
  }

  function ask(column: CompareColumn) {
    if (!view) return;
    if (column.alert !== "none" || !column.matchesSuggestion) {
      setShown(column);
      setPending(column);
      setAcknowledged(false);
      setReason("");
      return;
    }
    commit(column, view, undefined);
  }

  function commit(column: CompareColumn, current: CompareView, ackReason: string | undefined) {
    const opened = startCase(householdId);
    const scenarioId =
      column.savedScenarioId ??
      addScenario({
        caseId: opened,
        householdId,
        name: column.draft.name,
        strategy: column.draft.strategy,
        loanSource: column.draft.loanSource,
        product: column.draft.product,
        termMonths: column.draft.termMonths,
        loanAmount: column.draft.loanAmount,
        loanRate: column.draft.loanRate,
        debtsPaidOff: column.draft.debtsPaidOff,
      });
    const suggested = current.suggestionSavedId ?? (column.matchesSuggestion ? scenarioId : "");
    recommend(scenarioId, ackReason, {
      differs: !column.matchesSuggestion,
      suggestedScenarioId: suggested,
    });
    setPending(null);
    toast.success("Plan recommended");
  }

  function choose(id: string) {
    startTransition(() => setSelectedId((current) => (current === id ? null : id)));
  }

  function addSuggestion() {
    if (!view) return;
    const next = nextComparison(view.columns, view.suggestionId);
    setReplaced(next.replaced);
    router.push(`/households/${householdId}/workspace?compare=${next.ids.join(",")}`);
  }

  if (!view || view.columns.length === 0) {
    return (
      <div className={cn("flex flex-col gap-3", actionBarOffset)}>
        {kept.failed ? (
          <StaleNotice failed stale={kept.stale} onRetry={kept.retry} />
        ) : (
          <p className="text-sm text-muted-foreground">Choose a scenario to compare.</p>
        )}
        <ActionBar name={householdName}>
          <Button disabled>Mark as recommended</Button>
          <Button variant="outline" onClick={back}>
            Back to scenarios
          </Button>
        </ActionBar>
      </div>
    );
  }

  const needsAck = shown != null && shown.alert !== "none";
  const needsReason = shown != null && (shown.alert !== "none" || !shown.matchesSuggestion);
  const reasonReady = reason.trim().length > 0;
  const canSave = shown != null && (!needsAck || acknowledged) && (!needsReason || reasonReady);

  return (
    <Profile id="compare">
    <div className={cn("flex min-w-0 flex-col gap-6", actionBarOffset)}>
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground">S4</p>
        <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
      </div>

      {notice ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm" role="status">
          Present opens after a plan is marked recommended.
        </p>
      ) : null}

      {view.addedBaselines ? (
        <p className="text-sm text-muted-foreground">Avalanche and snowball are included next to the loan.</p>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4" data-testid="suggestion">
        <p className="text-sm text-muted-foreground">Suggestion</p>
        <p className="font-medium">
          <span className="mr-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Suggested</span>
          {view.suggestionName}
        </p>
        <p data-testid="suggestion-why">{view.why}</p>
        {view.columns.some((column) => column.id === view.suggestionId) ? null : (
          <Button type="button" variant="outline" onClick={addSuggestion}>
            Add to comparison
          </Button>
        )}
        {replaced ? <p className="text-sm">Replaced {replaced}.</p> : null}
      </section>

      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {view.columns.map((column) => {
          const yours = column.savedScenarioId != null && column.savedScenarioId === caseRow?.recommended_scenario_id;
          return (
            <div
              key={column.id}
              role="button"
              tabIndex={0}
              data-scenario={column.name}
              aria-pressed={active?.id === column.id}
              data-pending={active?.id === column.id ? "true" : undefined}
              onPointerDown={(event) => {
                event.currentTarget.dataset.pending = "true";
              }}
              onClick={() => choose(column.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose(column.id);
                }
              }}
              className={cn(
                "flex min-w-0 flex-col gap-3 rounded-lg border p-4 text-left",
                column.badges.includes("Today") ? "bg-muted" : "bg-card",
                active?.id === column.id && "ring-2 ring-foreground",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-medium">{column.name}</h2>
                <div className="flex flex-wrap gap-1">
                  {column.badges.map((badge) => (
                    <span
                      key={badge}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        badge === "Suggested"
                          ? "bg-primary text-primary-foreground"
                          : badge === "Today"
                            ? "bg-foreground text-background"
                            : "border text-muted-foreground",
                      )}
                    >
                      {badge}
                    </span>
                  ))}
                  {yours && !column.badges.includes("Previously recommended") ? (
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Previously recommended</span>
                  ) : null}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Debt free by</dt>
                <dd>{column.debtFreeDate}</dd>
                <dt className="text-muted-foreground">Months saved</dt>
                <dd><SavingsText value={column.monthsSaved} reason={view.comparableNote} /></dd>
                <dt className="text-muted-foreground">Total interest</dt>
                <dd><SavingsText value={column.interest} /></dd>
                <dt className="text-muted-foreground">Interest saved</dt>
                <dd><SavingsText value={column.interestSaved} reason={view.comparableNote} /></dd>
                <dt className="text-muted-foreground">Monthly payment</dt>
                <dd>{column.monthly}</dd>
              </dl>
              <PaymentDot alert={column.alert} label={column.alertLabel} />
              {column.note ? <p className="text-sm text-muted-foreground">{column.note}</p> : null}
            </div>
          );
        })}
      </div>

      {active ? (
        <section className="flex min-w-0 flex-col gap-3" data-testid="selected-plan">
          <h2 className="text-lg font-medium">With the selected plan: {active.name}</h2>
          <div className="rounded-lg border p-4" data-testid="money-goes">
            <h3 className="mb-2 font-medium">Where the money goes</h3>
            {active.moneyGoes.length === 0 ? (
              <p className="text-sm">No payment changes.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {active.moneyGoes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          <h3 className="font-medium">Month by month</h3>
          <BalanceChart column={active} />
          <div className="max-h-96 min-w-0 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  {active.series.map((series) => (
                    <TableHead key={series.key}>{series.name}</TableHead>
                  ))}
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.points.map((point) => (
                  <TableRow key={point.label}>
                    <TableCell>{point.label}</TableCell>
                    {point.balances.map((balance, index) => (
                      <TableCell key={active.series[index]?.key ?? index}>{formatMoney(balance)}</TableCell>
                    ))}
                    <TableCell>{formatMoney(point.balances.reduce((sum, value) => sum + value, 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Payoff order</h3>
            {active.payoff.length === 0 ? (
              <p className="text-sm text-muted-foreground">{active.note ?? "No debt is paid off."}</p>
            ) : (
              <ol className="flex flex-col gap-1 text-sm">
                {active.payoff.map((step, index) => (
                  <li key={`${step.name}-${step.when}-${index}`}>
                    {index + 1}. {step.name} — {step.when}
                    {step.edits.map((line) => (
                      <span key={line} className="block text-muted-foreground">{line}</span>
                    ))}
                    {step.resolved ? <span className="block text-muted-foreground">Resolved in this case</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      ) : null}

      {pending ? <Dialog open onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as recommended</DialogTitle>
            <DialogDescription>
              {shown?.name}. This is saved on the case.
            </DialogDescription>
          </DialogHeader>
          {needsAck ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(Boolean(checked))} />
              <span>I acknowledge the payment alert ({shown?.alertLabel}).</span>
            </label>
          ) : null}
          {needsReason ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {shown && !shown.matchesSuggestion
                  ? "This is not the suggested plan. Say why you're recommending it."
                  : "Say why you're recommending a plan with a payment alert."}
              </span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <BusyButton
              label="Recommend this plan"
              pendingLabel="Saving…"
              disabled={!canSave}
              onAction={() => {
                if (shown && canSave) commit(shown, view, reason.trim());
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog> : null}
      <ActionBar name={householdName}>
        {hasRecommendation ? (
          <>
            <PresentLink
              href={`/households/${householdId}/present?compared=${encodeURIComponent(view.columns.map((column) => column.id).filter((id) => id !== "current").join(","))}`}
            />
            <BusyButton
              label="Change recommendation"
              pendingLabel="Saving…"
              disabled={!active?.recommendable || selectedIsRecommended}
              onAction={() => {
                if (active?.recommendable && !selectedIsRecommended) ask(active);
              }}
            />
          </>
        ) : (
          <BusyButton
            label="Mark as recommended"
            pendingLabel="Saving…"
            disabled={!active?.recommendable}
            onAction={() => {
              if (active?.recommendable) ask(active);
            }}
          />
        )}
        <Button variant="outline" onClick={back}>
          Back to scenarios
        </Button>
      </ActionBar>
    </div>
    </Profile>
  );
}

function BusyButton({
  label,
  pendingLabel,
  disabled,
  onAction,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
  onAction: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={disabled || pending}
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.dataset.pending = "true";
      }}
      onClick={() => {
        if (disabled || pending) return;
        setPending(true);
        startTransition(() => {
          onAction();
          setPending(false);
        });
      }}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

function PresentLink({ href }: { href: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Link
      href={href}
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
      className={buttonVariants({ variant: "outline" })}
      onPointerDown={(event) => {
        event.currentTarget.dataset.pending = "true";
      }}
      onClick={() => setPending(true)}
    >
      {pending ? "Opening…" : "Present"}
    </Link>
  );
}

const BalanceChart = memo(function BalanceChart({ column }: { column: CompareColumn }) {
  const stride = column.points.length > 240 ? Math.ceil(column.points.length / 240) : 1;
  const data = column.points.flatMap((point, index) => {
    if (index % stride !== 0 && index !== column.points.length - 1) return [];
    const row: Record<string, string | number> = { label: point.label };
    point.balances.forEach((balance, seriesIndex) => {
      const key = column.series[seriesIndex]?.key;
      if (key) row[key] = balance;
    });
    return [row];
  });
  if (data.length === 0) return null;
  return (
    <div className="h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis tickFormatter={(value: number) => axisMoney(value)} tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={(value) => formatMoney(Number(value ?? 0))} />
          <Legend />
          {column.series.map((series, index) => (
            <Area
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.name}
              stackId="balance"
              stroke={SERIES_COLOR[index % SERIES_COLOR.length]}
              fill={SERIES_COLOR[index % SERIES_COLOR.length]}
              fillOpacity={0.85}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

function axisMoney(value: number): string {
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

