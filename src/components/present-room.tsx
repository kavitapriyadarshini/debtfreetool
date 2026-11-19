"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionBar, actionBarOffset } from "@/components/action-bar";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AS_OF } from "@/lib/config";
import { outreachReasonRequired } from "@/lib/decision";
import { outreachStatus } from "@/lib/engine/outreach";
import { formatDate } from "@/lib/format";
import { presentFor, type PresentColumn, type PresentYear } from "@/lib/present";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ContactChannel, Decision } from "@/lib/types";

export function PresentRoom({
  householdId,
  initialPlan,
  compared = "",
}: {
  householdId: string;
  initialPlan: string;
  compared?: string;
}) {
  const cases = useDemoStore((state) => state.cases);
  const scenarios = useDemoStore((state) => state.scenarios);
  const overrides = useDemoStore((state) => state.caseOverrides);
  const extraPayments = useDemoStore((state) => state.extraPayments);
  const customLoans = useDemoStore((state) => state.customLoans);
  const startCase = useDemoStore((state) => state.startCase);
  const addScenario = useDemoStore((state) => state.addScenario);
  const recommend = useDemoStore((state) => state.recommend);
  const recordDecision = useDemoStore((state) => state.recordDecision);
  const contacts = useDemoStore((state) => state.contacts);
  const role = useDemoStore((state) => state.user.role);
  const [planId, setPlanId] = useState(initialPlan);
  const [showing, setShowing] = useState<"plan" | "today">("plan");
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [pending, setPending] = useState<Decision | null>(null);
  const [recorded, setRecorded] = useState<{ label: string; until: string } | null>(null);
  const [channel, setChannel] = useState<ContactChannel | "">("");
  const [reason, setReason] = useState("");
  const router = useRouter();

  const caseRow = useMemo(() => {
    const matches = cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1] ?? null;
  }, [cases, householdId]);

  const comparedIds = useMemo(() => compared.split(",").map((id) => id.trim()).filter((id) => id !== ""), [compared]);
  const kept = useKeptResult(
    () =>
      presentFor(
        householdId,
        caseRow?.case_id ?? null,
        { overrides, extraPayments, customLoans },
        scenarios,
        planId,
        comparedIds,
      ),
    [householdId, caseRow?.case_id, overrides, extraPayments, customLoans, scenarios, planId, comparedIds],
  );
  const model = kept.value;
  const recommendedId = caseRow?.recommended_scenario_id ?? null;

  useEffect(() => {
    if (recommendedId) return;
    router.replace(`/households/${householdId}/workspace?compare=current&notice=recommend`);
  }, [recommendedId, householdId, router]);

  if (!recommendedId) {
    return (
      <div className="flex min-h-screen flex-col gap-3 p-8">
        <p>Present opens after a plan is marked recommended.</p>
      </div>
    );
  }

  if (!model && kept.failed) {
    return (
      <div className="flex min-h-screen flex-col gap-3 p-8">
        <h1 className="text-2xl font-semibold">Household {householdId}</h1>
        <StaleNotice failed stale={kept.stale} onRetry={kept.retry} />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex min-h-screen flex-col gap-3 p-8">
        <h1 className="text-2xl font-semibold">Household {householdId}</h1>
        <p>This household is not in the book.</p>
      </div>
    );
  }

  const choice = model.choices.find((row) => row.id === model.selectedId) ?? model.choices[0];
  const needsReason = channel === "advisor_outreach" && outreachReasonRequired(contacts, householdId, "advisor_outreach");
  const canSave = channel !== "" && (!needsReason || reason.trim() !== "");

  function openDecision(outcome: Decision) {
    setChannel("");
    setReason("");
    setRecorded(null);
    setPending(outcome);
  }

  function saveDecision() {
    if (!choice || !pending || channel === "" || !canSave) return;
    const opened = caseRow?.case_id ?? startCase(householdId);
    const scenarioId =
      choice.savedId ??
      addScenario({
        caseId: opened,
        householdId,
        name: choice.draft.name,
        strategy: choice.draft.strategy,
        loanSource: choice.draft.loanSource,
        product: choice.draft.product,
        termMonths: choice.draft.termMonths,
        loanAmount: choice.draft.loanAmount,
        loanRate: choice.draft.loanRate,
        debtsPaidOff: choice.draft.debtsPaidOff,
      });
    const current = useDemoStore.getState().cases.find((row) => row.case_id === opened);
    if (current?.recommended_scenario_id !== scenarioId) recommend(scenarioId);
    const saved = recordDecision(opened, pending, { channel, reason });
    if (!saved) {
      toast.error("A reason is required during a waiting period.");
      return;
    }
    const outcome = pending;
    setPending(null);
    if (outcome === "agreed") {
      router.push(`/households/${householdId}/summary`);
      return;
    }
    const next = useDemoStore.getState().contacts.filter((row) => row.household_id === householdId);
    const until = outreachStatus(next, AS_OF).eligible_for_outreach_from;
    setRecorded({ label: answerLabel(outcome), until: until ? formatDate(until) : "" });
  }

  const years = showing === "plan" ? model.plan.years : model.today.years;
  const canSwitch = role === "advisor" || role === "manager";

  return (
    <div className={cn("min-h-screen bg-background px-6 py-10 text-foreground sm:px-10", actionBarOffset)}>
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
        {recorded ? (
          <p role="status" className="rounded-xl bg-muted px-4 py-3 text-lg">
            {recorded.label} is recorded.{recorded.until ? ` No new plan until ${recorded.until}.` : ""}
          </p>
        ) : null}
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{model.title}</h1>
          <p className="text-lg text-muted-foreground">
            {model.advisor} · {model.date}
          </p>
        </header>

        <Comparison columns={model.columns} canSwitch={canSwitch} onSwitch={setPlanId} />

        {model.advantages.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl font-semibold">What&apos;s good about this plan</h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-lg">
              {model.advantages.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {model.thingsToKnow.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-2xl font-semibold">Things to know</h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-lg">
              {model.thingsToKnow.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">Month by month</h2>
            <div role="group" aria-label="Which schedule" className="flex gap-2">
              <Button size="sm" variant={showing === "plan" ? "default" : "outline"} aria-pressed={showing === "plan"} onClick={() => { setShowing("plan"); setOpenYear(null); }}>
                Your plan
              </Button>
              <Button size="sm" variant={showing === "today" ? "default" : "outline"} aria-pressed={showing === "today"} onClick={() => { setShowing("today"); setOpenYear(null); }}>
                Today
              </Button>
            </div>
          </div>
          {years.length === 0 ? (
            <p className="text-lg text-muted-foreground">{showing === "plan" ? model.plan.debtFree : model.today.debtFree}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {years.map((year) => (
                <YearBlock key={year.year} year={year} open={openYear === year.year} onToggle={() => setOpenYear(openYear === year.year ? null : year.year)} />
              ))}
            </div>
          )}
        </section>

        {caseRow?.decision ? <p className="text-lg text-muted-foreground">Answer recorded: {answerLabel(caseRow.decision)}</p> : null}
      </div>
      <ActionBar name={model.name} edge="screen">
        <Button size="lg" onClick={() => openDecision("agreed")}>
          Agreed
        </Button>
        <Button size="lg" variant="outline" onClick={() => openDecision("declined")}>
          Not now
        </Button>
        <Button size="lg" variant="outline" onClick={() => openDecision("undecided")}>
          Needs time
        </Button>
        <Link
          href={`/households/${householdId}/workspace`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "font-normal text-muted-foreground")}
        >
          Back to workspace
        </Link>
      </ActionBar>
      {pending ? <Dialog open onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record the answer</DialogTitle>
            <DialogDescription>
              {pending ? `${answerLabel(pending)}. ` : ""}The date is {formatDate(AS_OF)}.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            How did you speak with them?
            <select
              className="rounded-md border bg-background px-2 py-1.5"
              value={channel}
              onChange={(event) => setChannel(event.target.value as ContactChannel | "")}
            >
              <option value="">Choose</option>
              <option value="servicing_call">Servicing call</option>
              <option value="advisor_outreach">Outreach</option>
              <option value="household_request">Household request</option>
            </select>
          </label>
          {needsReason ? (
            <label className="flex flex-col gap-1 text-sm">
              This household is in a waiting period. Say why you are reaching out.
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={saveDecision}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog> : null}
    </div>
  );
}

const ROWS: { label: string; value: (column: PresentColumn) => string }[] = [
  { label: "Debt free by", value: (column) => column.debtFree },
  { label: "How much sooner", value: (column) => column.sooner },
  { label: "Total interest", value: (column) => column.interest },
  { label: "Interest you save", value: (column) => column.interestSaved },
  { label: "Monthly payment", value: (column) => column.monthly },
];

function Comparison({
  columns,
  canSwitch,
  onSwitch,
}: {
  columns: PresentColumn[];
  canSwitch: boolean;
  onSwitch: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-left">
        <caption className="sr-only">Today, your plan, and the other plans you compared</caption>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-40 bg-background" />
            {columns.map((column) => (
              <th
                key={column.id}
                className={cn(
                  "min-w-52 px-4 py-3 align-bottom text-base font-semibold",
                  column.tone === "other" ? "bg-muted text-muted-foreground" : "text-foreground",
                )}
              >
                {column.tone === "other" && canSwitch ? (
                  <button type="button" className="text-left font-medium text-muted-foreground underline-offset-2 hover:underline" onClick={() => onSwitch(column.id)}>
                    {column.heading}
                  </button>
                ) : (
                  column.heading
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-3 text-sm font-medium text-muted-foreground">
                {row.label}
              </th>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    "px-4 py-3 align-top text-base",
                    column.tone === "other" ? "bg-muted/70 text-muted-foreground" : "text-foreground",
                    column.tone === "other" && canSwitch && "cursor-pointer",
                  )}
                  onClick={column.tone === "other" && canSwitch ? () => onSwitch(column.id) : undefined}
                >
                  {row.value(column)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-3 text-sm font-medium text-muted-foreground">
              Order your debts are paid off
            </th>
            {columns.map((column) => (
              <td
                key={column.id}
                className={cn(
                  "px-4 py-3 align-top",
                  column.tone === "other" ? "bg-muted/70 text-muted-foreground" : "text-foreground",
                  column.tone === "other" && canSwitch && "cursor-pointer",
                )}
                onClick={column.tone === "other" && canSwitch ? () => onSwitch(column.id) : undefined}
              >
                {column.payoff.length === 0 ? (
                  column.debtFree
                ) : (
                  <ol className="flex list-decimal flex-col gap-1 pl-4 text-sm">
                    {column.payoff.map((step, index) => (
                      <li key={`${column.id}-${step.name}-${step.when}-${index}`}>
                        {step.name}
                        <span className="text-muted-foreground"> · {step.when}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function YearBlock({ year, open, onToggle }: { year: PresentYear; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border">
      <button type="button" className="flex w-full flex-col gap-1 px-4 py-3 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="text-lg font-semibold">{year.year}</span>
        <span className="text-sm text-muted-foreground">
          Balance at the start {year.startBalance}. Balance at the end {year.endBalance}.
        </span>
        <span className="text-sm text-muted-foreground">
          Debts cleared: {year.cleared.length > 0 ? year.cleared.join(", ") : "None"}
        </span>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Each month in {year.year}</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Debt</th>
                <th className="px-4 py-2 font-medium">Payment</th>
                <th className="px-4 py-2 font-medium">Interest</th>
                <th className="px-4 py-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {year.months.flatMap((month) =>
                month.debts.map((debt) => (
                  <tr key={`${month.label}-${debt.name}`} className="border-t">
                    <td className="px-4 py-2">{month.label}</td>
                    <td className="px-4 py-2">{debt.name}</td>
                    <td className="px-4 py-2">{debt.payment}</td>
                    <td className="px-4 py-2">{debt.interest}</td>
                    <td className="px-4 py-2">{debt.balance}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function answerLabel(decision: Decision): string {
  if (decision === "agreed") return "Agreed";
  if (decision === "declined") return "Not now";
  return "Needs time";
}
