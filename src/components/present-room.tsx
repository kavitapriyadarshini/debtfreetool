"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { formatDate } from "@/lib/format";
import { presentFor, type PresentChoice, type PresentModel, type PresentSide } from "@/lib/present";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ContactChannel, Decision } from "@/lib/types";

export function PresentRoom({ householdId, initialPlan }: { householdId: string; initialPlan: string }) {
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
  const [pending, setPending] = useState<Decision | null>(null);
  const [channel, setChannel] = useState<ContactChannel | "">("");
  const [reason, setReason] = useState("");
  const router = useRouter();

  const caseRow = useMemo(() => {
    const matches = cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1] ?? null;
  }, [cases, householdId]);

  const kept = useKeptResult(
    () =>
      presentFor(
        householdId,
        caseRow?.case_id ?? null,
        { overrides, extraPayments, customLoans },
        scenarios,
        planId,
      ),
    [householdId, caseRow?.case_id, overrides, extraPayments, customLoans, scenarios, planId],
  );
  const model = kept.value;

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
    toast.success("Answer saved");
  }

  return (
    <div className={cn("relative min-h-screen bg-background px-6 py-10 text-foreground sm:px-10", actionBarOffset)}>
      <AdvisorBar model={model} onPlan={setPlanId} />
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
        <header className="flex flex-col gap-2 pr-16">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{model.name}</h1>
          {model.estimated ? <p className="text-lg text-muted-foreground">Credit score estimated</p> : null}
        </header>

        <div className="grid gap-8 md:grid-cols-2">
          <Column title="Today" side={model.today} />
          <Column title="Your plan" side={model.plan} emphasis>
            <p className="text-lg">Interest saved {model.interestSaved}</p>
            <p className="text-lg">{model.monthsSooner}</p>
            {model.loan ? <p className="text-lg">{model.loan}</p> : null}
          </Column>
        </div>

        {model.leftOut.length > 0 ? (
          <ul className="flex flex-col gap-1 text-lg text-muted-foreground">
            {model.leftOut.map((name) => (
              <li key={name}>{name} is not included in this plan.</li>
            ))}
          </ul>
        ) : null}

        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">What gets paid off</h2>
          {model.plan.payoff.length === 0 ? (
            <p className="text-lg text-muted-foreground">{model.plan.debtFree}</p>
          ) : (
            <ol className="flex flex-col gap-5 border-l border-foreground/15 pl-6">
              {model.plan.payoff.map((step, index) => (
                <li key={`${step.name}-${step.when}-${index}`} className="relative">
                  <span className="absolute top-2 -left-[1.85rem] size-3 rounded-full bg-primary" />
                  <p className="text-xl">{step.name}</p>
                  <p className="text-muted-foreground">{step.when}</p>
                </li>
              ))}
            </ol>
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
        {role === "advisor" ? (
          <Link
            href={`/households/${householdId}/workspace`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "font-normal text-muted-foreground")}
          >
            Back to workspace
          </Link>
        ) : null}
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

function Column({
  title,
  side,
  emphasis,
  children,
}: {
  title: string;
  side: PresentSide;
  emphasis?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={emphasis ? "flex flex-col gap-4 rounded-2xl bg-card p-6 ring-1 ring-primary/30" : "flex flex-col gap-4 p-6"} data-column={title}>
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">Debt free by</p>
      <p className="text-3xl font-semibold tracking-tight sm:text-4xl">{side.debtFree}</p>
      <p className="text-lg">Total interest {side.interest}</p>
      <p className="text-lg">Monthly payment {side.monthly}</p>
      {children}
    </section>
  );
}

function AdvisorBar({
  model,
  onPlan,
}: {
  model: PresentModel;
  onPlan: (id: string) => void;
}) {
  return (
    <details className="absolute top-4 right-4 z-10 text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded-md px-2 py-1 hover:bg-muted">Advisor</summary>
      <div className="mt-2 flex w-56 flex-col gap-2 rounded-lg bg-card p-3 shadow-lg ring-1 ring-foreground/10">
        <label className="flex flex-col gap-1">
          Plan on screen
          <select
            className="rounded-md border bg-background px-2 py-1 text-foreground"
            value={model.selectedId}
            onChange={(event) => onPlan(event.target.value)}
          >
            {model.choices.map((choice: PresentChoice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}

function answerLabel(decision: Decision): string {
  if (decision === "agreed") return "Agreed";
  if (decision === "declined") return "Not now";
  return "Needs time";
}
