"use client";

import { useEffect, useState } from "react";
import { ActionBar, actionBarOffset } from "@/components/action-bar";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import { SavingsText } from "@/components/savings-text";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  OVERVIEW_TAB_LABEL,
  OVERVIEW_TABS,
  buildHouseholdOverview,
  editedValueLine,
  overviewTab,
  type EditableField,
  type FieldNote,
  type OverviewTab,
  type ShownField,
} from "@/lib/household-overview";
import { NOT_COMPARABLE } from "@/lib/format";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const COMFORT_ITEMS = { "1": "Zone 1", "2": "Zone 2", "3": "Zone 3" };

type DialogState = { mode: "edit" | "report"; field: EditableField } | null;

export function HouseholdOverview({
  householdId,
  tab,
  tabInUrl,
}: {
  householdId: string;
  tab: OverviewTab;
  tabInUrl: boolean;
}) {
  const router = useRouter();
  const caseRow = useDemoStore((state) => {
    const matches = state.cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1] ?? null;
  });
  const caseId = caseRow?.case_id ?? null;
  const recommendedScenarioId = caseRow?.recommended_scenario_id ?? null;
  const scenarios = useDemoStore((state) => state.scenarios);
  const extraPayments = useDemoStore((state) => state.extraPayments);
  const customLoans = useDemoStore((state) => state.customLoans);
  const overrides = useDemoStore((state) => state.caseOverrides);
  const contacts = useDemoStore((state) => state.contacts);
  const history = useDemoStore((state) => state.caseHistory);
  const snapshots = useDemoStore((state) => state.snapshots ?? []);
  const startCase = useDemoStore((state) => state.startCase);
  const addOverride = useDemoStore((state) => state.addOverride);
  const reportDataIssue = useDemoStore((state) => state.reportDataIssue);

  const kept = useKeptResult(
    () =>
      buildHouseholdOverview({
        householdId,
        caseId,
        overrides,
        contacts,
        history,
        snapshots,
        recommendedScenarioId,
        scenarios,
        extraPayments,
        customLoans,
      }),
    [householdId, caseId, overrides, contacts, history, snapshots, recommendedScenarioId, scenarios, extraPayments, customLoans],
  );
  const overview = kept.value;

  const [dialog, setDialog] = useState<DialogState>(null);
  const [opening, setOpening] = useState(false);
  const [selectedTab, setSelectedTab] = useState(tab);

  useEffect(() => {
    setSelectedTab(tab);
  }, [tab]);

  useEffect(() => {
    if (tabInUrl) return;
    router.replace(`/households/${householdId}?tab=debts`, { scroll: false });
  }, [householdId, router, tabInUrl]);

  function selectTab(next: string | null) {
    const chosen = overviewTab(next ?? undefined);
    setSelectedTab(chosen);
    router.replace(`/households/${householdId}?tab=${chosen}`, { scroll: false });
  }
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openEdit(field: EditableField) {
    setDialog({ mode: "edit", field });
    setReason("");
    setError(null);
    if (field.kind === "exclude") setDraft("");
    else if (field.currentValue == null || field.currentValue === "") setDraft("");
    else setDraft(String(field.currentValue));
  }

  function openReport(field: EditableField) {
    setDialog({ mode: "report", field });
    setReason("");
    setError(null);
    setDraft("");
  }

  function closeDialog() {
    setDialog(null);
    setError(null);
  }

  function ensureCase(): string {
    return startCase(householdId);
  }

  function saveEdit() {
    if (!dialog || dialog.mode !== "edit" || !overview) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Enter a reason.");
      return;
    }
    const field = dialog.field;
    let overrideValue: EditableField["currentValue"] = field.currentValue;
    if (field.kind === "exclude") {
      overrideValue = true;
    } else if (field.kind === "comfort") {
      const zone = Number(draft);
      if (zone !== 1 && zone !== 2 && zone !== 3) {
        setError("Choose a comfort zone.");
        return;
      }
      overrideValue = zone;
    } else if (field.kind === "property") {
      if (!overview.properties.some((property) => property.propertyId === draft)) {
        setError("Choose a property.");
        return;
      }
      overrideValue = draft;
    } else {
      const parsed = Number(draft);
      if (draft.trim() === "" || !Number.isFinite(parsed)) {
        setError("Enter a number.");
        return;
      }
      if (field.kind === "fico" && (!Number.isInteger(parsed) || parsed < 300 || parsed > 850)) {
        setError("Enter a FICO score from 300 to 850.");
        return;
      }
      if (field.kind === "rate" && (parsed < 0 || parsed > 100)) {
        setError("Enter a rate from 0 to 100.");
        return;
      }
      if (parsed < 0) {
        setError("Enter a number that is zero or more.");
        return;
      }
      overrideValue = parsed;
    }

    const opened = ensureCase();
    addOverride({
      caseId: opened,
      householdId,
      entityType: field.entityType,
      entityId: field.entityId,
      field: field.field,
      sourceValue: field.sourceValue,
      overrideValue,
      reason: trimmed,
    });
    closeDialog();
    toast.success("Saved for this case");
  }

  function saveReport() {
    if (!dialog || dialog.mode !== "report") return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Enter a reason.");
      return;
    }
    const field = dialog.field;
    const opened = ensureCase();
    reportDataIssue({
      caseId: opened,
      householdId,
      entityType: field.entityType,
      entityId: field.entityId,
      field: field.field,
      reason: trimmed,
    });
    closeDialog();
    toast.success("Data issue reported");
  }

  if (!overview && kept.failed) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Household {householdId}</h1>
        <StaleNotice failed stale={kept.stale} onRetry={kept.retry} />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Household {householdId}</h1>
        <p className="text-sm text-muted-foreground">This household is not in the book.</p>
      </div>
    );
  }

  const propertyItems = Object.fromEntries(
    overview.properties.map((property) => [property.propertyId, property.address]),
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", actionBarOffset)}>
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <div className="sticky top-0 z-30 -mx-4 flex flex-col gap-3 border-b bg-background px-4 pb-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{overview.name}</h1>
          <p className="text-sm text-muted-foreground">
            {overview.advisor} · {overview.state}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-5">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Comfort zone</dt>
            <dd>
              <FieldView field={overview.comfort} onEdit={openEdit} onReport={openReport} />
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Household FICO</dt>
            <dd data-testid="household-fico">
              {overview.fico.overrides.length > 0 ? (
                overview.fico.overrides.map((row) => (
                  <p key={`${row.original}-${row.next}-${row.at}`}>{editedValueLine(overview.fico.text, row)}</p>
                ))
              ) : (
                <p>
                  {overview.fico.text}
                  {overview.fico.whose ? <span className="text-muted-foreground"> · {overview.fico.whose}</span> : null}
                </p>
              )}
              {overview.fico.whose && overview.fico.overrides.length > 0 ? (
                <p className="text-muted-foreground">{overview.fico.whose}</p>
              ) : null}
              {overview.fico.flag ? <FlagNote text={overview.fico.flag} /> : null}
              {overview.fico.resolved ? <p className="text-sm text-muted-foreground">{overview.fico.resolved}</p> : null}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Income</dt>
            <dd>
              <p>{overview.income.text}</p>
              {overview.income.note ? <FlagNote text={overview.income.note} /> : null}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Outreach</dt>
            <dd>
              <p>{overview.outreach}</p>
              {overview.readyDate ? <p className="text-muted-foreground">Ready {overview.readyDate}</p> : null}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-0.5 lg:col-span-1">
            <dt className="text-muted-foreground">{overview.planInPlay.label}</dt>
            <dd>
              <p>
                {overview.planInPlay.months == null ? (
                  <>
                    Plan in play saves: <SavingsText value={NOT_COMPARABLE} reason={overview.planInPlay.note} />
                  </>
                ) : (
                  <>
                    Plan in play saves: {overview.planInPlay.months} and {overview.planInPlay.interest} vs today
                  </>
                )}
              </p>
            </dd>
          </div>
        </dl>
        {overview.waiting ? (
          <Alert data-testid="waiting-banner">
            <AlertTitle>Waiting period</AlertTitle>
            <AlertDescription>{overview.waiting}</AlertDescription>
          </Alert>
        ) : null}
        {overview.dataChanged ? (
          <Alert data-testid="data-changed">
            <AlertDescription>Data has changed since this plan was agreed</AlertDescription>
          </Alert>
        ) : null}
        {overview.fastAppReason ? <p className="text-sm text-muted-foreground">{overview.fastAppReason}</p> : null}
        <Tabs value={selectedTab} onValueChange={selectTab}>
          <TabsList variant="line" className="h-auto w-full justify-start">
            {OVERVIEW_TABS.map((item) => (
              <TabsTrigger key={item} value={item}>
                {OVERVIEW_TAB_LABEL[item]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {selectedTab === "debts" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Debt</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Interest rate</TableHead>
              <TableHead>Monthly payment</TableHead>
              <TableHead>Property</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.debts.map((debt) => (
              <TableRow key={debt.debtId} className={debt.grey ? "text-muted-foreground" : undefined}>
                <TableCell>
                  <div className="font-medium">{debt.name}</div>
                  <div className="text-xs">{debt.type}</div>
                  {debt.rowNotes.map((note) => (
                    <NoteLine key={note.text} note={note} />
                  ))}
                  {debt.exclude ? (
                    <div className="mt-2">
                      <FieldView
                        field={debt.exclude}
                        onEdit={openEdit}
                        onReport={openReport}
                        hideText
                        editLabel="Exclude from plans"
                      />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{debt.balance}</TableCell>
                <TableCell>
                  <FieldView field={debt.rate} onEdit={openEdit} onReport={openReport} />
                </TableCell>
                <TableCell>
                  <FieldView field={debt.payment} onEdit={openEdit} onReport={openReport} />
                </TableCell>
                <TableCell>
                  {debt.link ? (
                    <FieldView field={debt.link} onEdit={openEdit} onReport={openReport} />
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {selectedTab === "members" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>FICO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.members.map((member) => (
              <TableRow key={member.memberId}>
                <TableCell>{member.name}</TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell>
                  <FieldView field={member.fico} onEdit={openEdit} onReport={openReport} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {selectedTab === "properties" ? (
        overview.properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">No property on file.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Value date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.properties.map((property) => (
                <TableRow key={property.propertyId}>
                  <TableCell>{property.address}</TableCell>
                  <TableCell>{property.type}</TableCell>
                  <TableCell>
                    <FieldView field={property.value} onEdit={openEdit} onReport={openReport} />
                  </TableCell>
                  <TableCell className={property.stale ? "text-payment-red" : undefined}>
                    {property.valueDate}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {selectedTab === "contacts" ? (
        overview.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not contacted yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Advisor</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>{contact.date}</TableCell>
                  <TableCell>{contact.advisor}</TableCell>
                  <TableCell>{contact.channel}</TableCell>
                  <TableCell>{contact.outcome}</TableCell>
                  <TableCell>{contact.plan}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {selectedTab === "history" ? (
        overview.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No case yet.</p>
        ) : (
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
              {overview.history.map((event) => (
                <TableRow key={event.seq}>
                  <TableCell>{event.at}</TableCell>
                  <TableCell>{event.event}</TableCell>
                  <TableCell>{event.by}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                    {event.note ?? event.ref ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {dialog ? (
        <Dialog open onOpenChange={(next) => { if (!next) closeDialog(); }}>
          <DialogContent>
            <CaseDialog
              dialog={dialog}
              draft={draft}
              reason={reason}
              error={error}
              propertyItems={propertyItems}
              onDraft={setDraft}
              onReason={setReason}
              onSave={dialog.mode === "edit" ? saveEdit : saveReport}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      <ActionBar name={overview.name}>
        <Button
          aria-busy={opening}
          onClick={() => {
            setOpening(true);
            window.setTimeout(() => {
              if (!overview.hasCase) startCase(householdId);
              router.push(`/households/${householdId}/workspace`);
            }, 0);
          }}
        >
          {opening ? "Opening…" : overview.hasCase ? "Continue case" : "Start case"}
        </Button>
      </ActionBar>
    </div>
  );
}

function FlagNote({ text }: { text: string }) {
  const red = text === "Never pays off" || text === "Property value is from before 2024";
  return (
    <p className={cn("flex items-start gap-1.5 text-sm", red ? "text-payment-red" : "text-payment-amber-foreground")}>
      <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

function NoteLine({ note }: { note: FieldNote }) {
  if (note.tone === "flag") return <FlagNote text={note.text} />;
  return <p className="text-sm text-muted-foreground">{note.text}</p>;
}

function FieldView({
  field,
  onEdit,
  onReport,
  hideText = false,
  editLabel = "Edit for this case",
}: {
  field: ShownField;
  onEdit: (field: EditableField) => void;
  onReport: (field: EditableField) => void;
  hideText?: boolean;
  editLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {field.override ? (
        <span>{editedValueLine(field.text, field.override)}</span>
      ) : hideText ? null : (
        <span>{field.text}</span>
      )}
      {field.notes.map((note) => (
        <NoteLine key={note.text} note={note} />
      ))}
      {field.edit || field.report ? (
        <div className="flex flex-wrap gap-1">
          {field.edit ? (
            <Button variant="ghost" size="xs" onClick={() => onEdit(field.edit!)}>
              {editLabel}
            </Button>
          ) : null}
          {field.report ? (
            <Button variant="ghost" size="xs" onClick={() => onReport(field.report!)}>
              Report data issue
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CaseDialog({
  dialog,
  draft,
  reason,
  error,
  propertyItems,
  onDraft,
  onReason,
  onSave,
}: {
  dialog: { mode: "edit" | "report"; field: EditableField };
  draft: string;
  reason: string;
  error: string | null;
  propertyItems: Record<string, string>;
  onDraft: (value: string) => void;
  onReason: (value: string) => void;
  onSave: () => void;
}) {
  const field = dialog.field;
  const editing = dialog.mode === "edit";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit for this case" : "Report data issue"}</DialogTitle>
        <DialogDescription>
          {field.label}. This stays on the case. Source data is left as it is.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 py-2">
        {editing && field.kind !== "exclude" ? (
          <ValueInput field={field} draft={draft} propertyItems={propertyItems} onDraft={onDraft} />
        ) : null}
        {editing && field.kind === "exclude" ? (
          <p className="text-sm text-muted-foreground">This debt will be left out of plans for this case.</p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          Reason
          <Textarea value={reason} onChange={(event) => onReason(event.target.value)} />
        </label>
        {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
        <Button type="submit">{editing ? "Save for this case" : "Report"}</Button>
      </DialogFooter>
    </form>
  );
}

function ValueInput({
  field,
  draft,
  propertyItems,
  onDraft,
}: {
  field: EditableField;
  draft: string;
  propertyItems: Record<string, string>;
  onDraft: (value: string) => void;
}) {
  if (field.kind === "comfort") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        New value
        <Select items={COMFORT_ITEMS} value={draft} onValueChange={(value) => { if (value) onDraft(value); }}>
          <SelectTrigger aria-label="Comfort zone">
            <SelectValue placeholder="Choose a zone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Zone 1</SelectItem>
            <SelectItem value="2">Zone 2</SelectItem>
            <SelectItem value="3">Zone 3</SelectItem>
          </SelectContent>
        </Select>
      </label>
    );
  }
  if (field.kind === "property") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        Property
        <Select items={propertyItems} value={draft} onValueChange={(value) => { if (value) onDraft(value); }}>
          <SelectTrigger aria-label="Property">
            <SelectValue placeholder="Choose a property" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(propertyItems).map(([id, address]) => (
              <SelectItem key={id} value={id}>
                {address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      New value
      <Input
        inputMode="decimal"
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
      />
    </label>
  );
}
