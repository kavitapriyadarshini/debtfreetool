"use client";

import { useMemo, useState, type ReactNode } from "react";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import { SavingsText } from "@/components/savings-text";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { households, pipelineResults } from "@/lib/data";
import {
  drillHouseholds,
  firmHistory,
  firmView,
  interestSavedText,
  monthsSavedText,
  type FirmDrill,
  type FirmHousehold,
  type FirmStage,
} from "@/lib/firm";
import { formatMonths, neverComparableReason, NOT_COMPARABLE } from "@/lib/format";
import { useDemoStore } from "@/lib/store";
import { listAdvisors } from "@/lib/users";

const STATUS: Record<string, string> = {
  in_progress: "In progress",
  proposed: "Proposed",
  agreed: "Agreed",
  declined: "Declined",
  undecided: "Undecided",
};

export function FirmView() {
  const cases = useDemoStore((state) => state.cases);
  const contacts = useDemoStore((state) => state.contacts);
  const scenarios = useDemoStore((state) => state.scenarios);
  const overrides = useDemoStore((state) => state.caseOverrides);
  const extraPayments = useDemoStore((state) => state.extraPayments);
  const customLoans = useDemoStore((state) => state.customLoans);
  const history = useDemoStore((state) => state.caseHistory);
  const [branch, setBranch] = useState("all");
  const [advisor, setAdvisor] = useState("all");
  const [drill, setDrill] = useState<FirmDrill | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);

  const branches = useMemo(() => [...new Set(households.map((household) => household.branch))].sort(), []);
  const advisors = listAdvisors().filter((person) => branch === "all" || person.branch === branch);
  const branchItems = { all: "All branches", ...Object.fromEntries(branches.map((name) => [name, name])) };
  const advisorItems = { all: "All advisors", ...Object.fromEntries(advisors.map((person) => [person.name, person.name])) };

  const kept = useKeptResult(
    () =>
      firmView({
        households,
        contacts,
        cases,
        scenarios,
        caseState: { overrides, extraPayments, customLoans },
        branch,
        advisor,
      }),
    [contacts, cases, scenarios, overrides, extraPayments, customLoans, branch, advisor],
  );
  const view = kept.value;

  function chooseBranch(value: string | null) {
    if (!value) return;
    setBranch(value);
    setAdvisor("all");
    setDrill(null);
    setHouseholdId(null);
  }

  function chooseAdvisor(value: string | null) {
    if (!value) return;
    setAdvisor(value);
    setDrill(null);
    setHouseholdId(null);
  }

  function openDrill(next: FirmDrill) {
    setHouseholdId(null);
    setDrill(next);
  }

  const detail = householdId
    ? firmHistory({ householdId, cases, history, contacts })
    : null;

  if (!view) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Firm view</h1>
        <StaleNotice failed stale={kept.stale} onRetry={kept.retry} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <header className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">S7</p>
          <h1 className="text-2xl font-semibold tracking-tight">Firm view</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Branch
            <Select items={branchItems} value={branch} onValueChange={chooseBranch}>
              <SelectTrigger aria-label="Branch" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Advisor
            <Select items={advisorItems} value={advisor} onValueChange={chooseAdvisor}>
              <SelectTrigger aria-label="Advisor" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All advisors</SelectItem>
                {advisors.map((person) => (
                  <SelectItem key={person.name} value={person.name}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </header>

      {detail && drill ? (
        <HistoryPanel detail={detail} onBack={() => setHouseholdId(null)} />
      ) : drill ? (
        <HouseholdList
          title={drillTitle(drill, view.funnel.find((row) => row.advisor === ("advisor" in drill ? drill.advisor : null))?.advisor)}
          households={drillHouseholds(view, drill)}
          showSavings={drill.kind === "agreed" || drill.kind === "months" || drill.kind === "interest"}
          onBack={() => setDrill(null)}
          onOpen={setHouseholdId}
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Opportunity</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Ready now" value={view.ready.length} testId="firm-ready" onClick={() => openDrill({ kind: "ready" })} />
              <Stat label="Waiting" value={view.waiting.length} testId="firm-waiting" onClick={() => openDrill({ kind: "waiting" })} />
              <Stat label="Progress check due" value={view.progress.length} testId="firm-progress" onClick={() => openDrill({ kind: "progress" })} />
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="text-lg font-semibold">Funnel</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Advisor</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Cased</TableHead>
                    <TableHead>Proposed</TableHead>
                    <TableHead>Agreed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.funnel.map((row) => (
                    <TableRow key={row.advisor}>
                      <TableCell>{row.advisor}</TableCell>
                      <TableCell>{row.branch}</TableCell>
                      <FunnelCell count={row.opportunity.length} onClick={() => openDrill({ kind: "funnel", stage: "opportunity", advisor: row.advisor })} />
                      <FunnelCell count={row.cased.length} onClick={() => openDrill({ kind: "funnel", stage: "cased", advisor: row.advisor })} />
                      <FunnelCell count={row.proposed.length} onClick={() => openDrill({ kind: "funnel", stage: "proposed", advisor: row.advisor })} />
                      <FunnelCell count={row.agreed.length} onClick={() => openDrill({ kind: "funnel", stage: "agreed", advisor: row.advisor })} />
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium">Firm</TableCell>
                    <TableCell>{branch === "all" ? "All branches" : branch}</TableCell>
                    <FunnelCell count={sum(view.funnel, "opportunity")} onClick={() => openDrill({ kind: "funnel", stage: "opportunity", advisor: null })} />
                    <FunnelCell count={sum(view.funnel, "cased")} onClick={() => openDrill({ kind: "funnel", stage: "cased", advisor: null })} />
                    <FunnelCell count={sum(view.funnel, "proposed")} onClick={() => openDrill({ kind: "funnel", stage: "proposed", advisor: null })} />
                    <FunnelCell count={sum(view.funnel, "agreed")} onClick={() => openDrill({ kind: "funnel", stage: "agreed", advisor: null })} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Results</h2>
            <p className="text-sm text-muted-foreground">Agreed plans, measured against what the household pays today.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Agreed plans" value={view.agreed.length} testId="firm-agreed" onClick={() => openDrill({ kind: "agreed" })} />
              <Stat label="Months saved" value={monthsSavedText(view.monthsSaved, view.fromNever)} testId="firm-months" onClick={() => openDrill({ kind: "months" })} />
              <Stat label="Interest saved" value={interestSavedText(view.interestSaved)} testId="firm-interest" onClick={() => openDrill({ kind: "interest" })} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function sum(rows: { opportunity: string[]; cased: string[]; proposed: string[]; agreed: string[] }[], stage: FirmStage): number {
  return rows.reduce((total, row) => total + row[stage].length, 0);
}

function Stat({ label, value, testId, onClick }: { label: string; value: number | string; testId: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 hover:ring-primary/40"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
    </button>
  );
}

function FunnelCell({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <TableCell>
      <button type="button" onClick={onClick} className="font-medium tabular-nums underline-offset-2 hover:underline">
        {count}
      </button>
    </TableCell>
  );
}

function HouseholdList({
  title,
  households: rows,
  showSavings,
  onBack,
  onOpen,
}: {
  title: string;
  households: FirmHousehold[];
  showSavings: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Button variant="outline" className="w-fit" onClick={onBack}>
        Back
      </Button>
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No households.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((household) => (
            <li key={household.householdId}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpen(household.householdId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(household.householdId);
                  }
                }}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded-lg bg-card px-3 py-2 text-left ring-1 ring-foreground/10 hover:ring-primary/40"
              >
                <span>
                  <span className="font-medium">{household.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {household.householdId} · {household.advisor}
                  </span>
                </span>
                {showSavings ? (
                  <span className="text-sm text-muted-foreground">
                    {householdSaving(household)}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryPanel({
  detail,
  onBack,
}: {
  detail: NonNullable<ReturnType<typeof firmHistory>>;
  onBack: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <Button variant="outline" className="w-fit" onClick={onBack}>
        Back to the list
      </Button>
      <header>
        <h2 className="text-xl font-semibold">{detail.name}</h2>
        <p className="text-sm text-muted-foreground">
          {detail.advisor}, {detail.branch}
          {detail.caseStatus ? ` · ${STATUS[detail.caseStatus] ?? detail.caseStatus}` : " · No case"}
        </p>
      </header>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Case history</h3>
        {detail.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No case yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.history.map((event, index) => (
                  <TableRow key={`${event.at}-${event.event}-${index}`}>
                    <TableCell>{event.at}</TableCell>
                    <TableCell>{event.event}</TableCell>
                    <TableCell>{event.by}</TableCell>
                    <TableCell>{event.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Contact history</h3>
        {detail.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not contacted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Advisor</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.contacts.map((contact, index) => (
                  <TableRow key={`${contact.at}-${contact.outcome}-${index}`}>
                    <TableCell>{contact.at}</TableCell>
                    <TableCell>{contact.advisor}</TableCell>
                    <TableCell>{contact.channel}</TableCell>
                    <TableCell>{contact.outcome}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  );
}

function householdSaving(household: FirmHousehold): ReactNode {
  if (household.monthsSaved === "from never") {
    const nightly = pipelineResults.find((row) => row.household_id === household.householdId);
    const months = nightly && nightly.best_plan_months !== "never" ? nightly.best_plan_months : null;
    const reason = neverComparableReason(months == null ? null : formatMonths(months));
    return (
      <span className="inline-flex flex-wrap gap-x-2">
        <SavingsText value={NOT_COMPARABLE} reason={reason} />
        <span>·</span>
        <SavingsText value={NOT_COMPARABLE} reason={reason} />
      </span>
    );
  }
  const months = typeof household.monthsSaved === "number" ? formatMonths(household.monthsSaved) : "—";
  const interest = household.interestSaved == null ? "—" : interestSavedText(household.interestSaved);
  return `${months} · ${interest}`;
}

function drillTitle(drill: FirmDrill, advisorName: string | undefined): string {
  if (drill.kind === "ready") return "Ready now";
  if (drill.kind === "waiting") return "Waiting";
  if (drill.kind === "progress") return "Progress check due";
  if (drill.kind === "agreed") return "Agreed plans";
  if (drill.kind === "months") return "Months saved";
  if (drill.kind === "interest") return "Interest saved";
  if (drill.kind !== "funnel") return "Households";
  const stage = drill.stage.charAt(0).toUpperCase() + drill.stage.slice(1);
  return drill.advisor == null ? stage : `${stage} · ${advisorName ?? drill.advisor}`;
}
