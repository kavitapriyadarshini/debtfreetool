"use client";

import { useState, type ReactNode } from "react";
import { ActionBar, actionBarOffset } from "@/components/action-bar";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import Link from "next/link";
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
import { Textarea } from "@/components/ui/textarea";
import {
  buildHouseholdOverview,
  type EditableField,
  type FieldNote,
  type ShownField,
  type ShownOverride,
} from "@/lib/household-overview";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const COMFORT_ITEMS = { "1": "Zone 1", "2": "Zone 2", "3": "Zone 3" };

function fieldKey(field: EditableField): string {
  return `${field.entityType}:${field.entityId}:${field.field}`;
}

function reportableFields(overview: NonNullable<ReturnType<typeof buildHouseholdOverview>>): EditableField[] {
  const found: EditableField[] = [];
  const take = (field: ShownField | null) => {
    if (field?.report) found.push(field.report);
  };
  take(overview.comfort);
  for (const member of overview.members) take(member.fico);
  for (const property of overview.properties) take(property.value);
  for (const debt of overview.debts) {
    take(debt.payment);
    take(debt.rate);
    take(debt.link);
    take(debt.exclude);
  }
  return found;
}

type DialogState = { mode: "edit" | "report"; field: EditableField } | null;

export function HouseholdOverview({ householdId }: { householdId: string }) {
  const router = useRouter();
  const caseId = useDemoStore((state) => {
    const matches = state.cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1]?.case_id ?? null;
  });
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
      }),
    [householdId, caseId, overrides, contacts, history, snapshots],
  );
  const overview = kept.value;

  const [dialog, setDialog] = useState<DialogState>(null);
  const [opening, setOpening] = useState(false);
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

  const issues = reportableFields(overview);

  return (
    <div className={cn("flex min-w-0 flex-col gap-8", actionBarOffset)}>
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{overview.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {overview.householdId} · {overview.advisor}, {overview.branch} · {overview.state}
          </p>
        </div>
        {snapshots.some((row) => row.household_id === householdId) ? (
          <Link
            href={`/households/${householdId}/summary`}
            className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted"
          >
            One-page summary
          </Link>
        ) : null}
      </header>

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

      {overview.fastAppReason ? (
        <p className="text-sm text-muted-foreground">{overview.fastAppReason}</p>
      ) : null}

      <dl className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Comfort zone</dt>
          <dd>
            <FieldView field={overview.comfort} onEdit={openEdit} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Household FICO</dt>
          <dd data-testid="household-fico">
            <p>{overview.fico.text}</p>
            {overview.fico.whose ? <p className="text-sm text-muted-foreground">{overview.fico.whose}</p> : null}
            {overview.fico.flag ? <FlagNote text={overview.fico.flag} /> : null}
            {overview.fico.overrides.map((row) => (
              <OverrideLine key={`${row.original}-${row.next}-${row.at}`} override={row} />
            ))}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Income</dt>
          <dd>
            <p>{overview.income.text}</p>
            {overview.income.note ? <FlagNote text={overview.income.note} /> : null}
          </dd>
        </div>
      </dl>

      <Section title="Members">
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
                  <FieldView field={member.fico} onEdit={openEdit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Properties">
        {overview.properties.length === 0 ? (
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
                    <FieldView field={property.value} onEdit={openEdit} />
                  </TableCell>
                  <TableCell className={property.stale ? "text-payment-red" : undefined}>
                    {property.valueDate}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Debts">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Debt</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Rate</TableHead>
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
                      <FieldView field={debt.exclude} onEdit={openEdit} hideText editLabel="Exclude from plans" />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{debt.balance}</TableCell>
                <TableCell>
                  <FieldView field={debt.payment} onEdit={openEdit} />
                </TableCell>
                <TableCell>
                  <FieldView field={debt.rate} onEdit={openEdit} />
                </TableCell>
                <TableCell>
                  {debt.link ? (
                    <FieldView field={debt.link} onEdit={openEdit} />
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Contact history">
        {overview.contacts.length === 0 ? (
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
        )}
      </Section>

      <Section title="Case history">
        {overview.history.length === 0 ? (
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
        )}
      </Section>

      {dialog ? (
        <Dialog open onOpenChange={(next) => { if (!next) closeDialog(); }}>
          <DialogContent>
            <CaseDialog
              dialog={dialog}
              fields={issues}
              draft={draft}
              reason={reason}
              error={error}
              propertyItems={propertyItems}
              onDraft={setDraft}
              onReason={setReason}
              onField={(field) => {
                setDialog({ mode: "report", field });
                setReason("");
                setError(null);
              }}
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
        <Button
          variant="outline"
          disabled={issues.length === 0}
          onClick={() => {
            const first = issues[0];
            if (first) openReport(first);
          }}
        >
          Report data issue
        </Button>
      </ActionBar>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
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

function OverrideLine({ override }: { override: ShownOverride }) {
  return (
    <p className="text-sm text-muted-foreground">
      {override.original} → {override.next}
      <span className="block">
        {override.by} · {override.at}
      </span>
    </p>
  );
}

function FieldView({
  field,
  onEdit,
  hideText = false,
  editLabel = "Edit for this case",
}: {
  field: ShownField;
  onEdit: (field: EditableField) => void;
  hideText?: boolean;
  editLabel?: string;
}) {
  return (
    <div className="flex min-w-40 flex-col gap-1">
      {hideText ? null : <span>{field.text}</span>}
      {field.override ? <OverrideLine override={field.override} /> : null}
      {field.notes.map((note) => (
        <NoteLine key={note.text} note={note} />
      ))}
      {field.edit ? (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="xs" onClick={() => onEdit(field.edit!)}>
            {editLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CaseDialog({
  dialog,
  fields,
  draft,
  reason,
  error,
  propertyItems,
  onDraft,
  onReason,
  onField,
  onSave,
}: {
  dialog: { mode: "edit" | "report"; field: EditableField };
  fields: EditableField[];
  draft: string;
  reason: string;
  error: string | null;
  propertyItems: Record<string, string>;
  onDraft: (value: string) => void;
  onReason: (value: string) => void;
  onField: (field: EditableField) => void;
  onSave: () => void;
}) {
  const field = dialog.field;
  const editing = dialog.mode === "edit";
  const issueItems = Object.fromEntries(fields.map((row) => [fieldKey(row), row.label]));
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
          {editing ? `${field.label}. ` : ""}This stays on the case. Source data is left as it is.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 py-2">
        {editing ? null : (
          <label className="flex flex-col gap-1 text-sm">
            Which value
            <Select
              items={issueItems}
              value={fieldKey(field)}
              onValueChange={(value) => {
                const next = fields.find((row) => fieldKey(row) === value);
                if (next) onField(next);
              }}
            >
              <SelectTrigger aria-label="Which value">
                <SelectValue placeholder="Choose a value" />
              </SelectTrigger>
              <SelectContent>
                {fields.map((row) => (
                  <SelectItem key={fieldKey(row)} value={fieldKey(row)}>
                    {row.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
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
