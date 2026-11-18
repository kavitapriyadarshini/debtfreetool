"use client";

import { useMemo, useState, type ReactNode } from "react";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CompareView } from "@/components/compare-view";
import { PLAN_START } from "@/lib/config";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  previewHousehold,
  rateText,
  workspaceFor,
  type DraftPreview,
  type OfferChoice,
  type ScenarioCard,
  type ScenarioDraft,
  type WorkspaceModel,
} from "@/lib/workspace";
import type { PaymentAlert, Scenario } from "@/lib/types";

const COMPARE_LIMIT = 4;

type ExtraRow = {
  key: string;
  id: string | null;
  type: "one_off" | "recurring";
  amount: string;
  month: string;
};

type Builder = {
  scenarioId: string | null;
  name: string;
  nameTouched: boolean;
  strategy: "avalanche" | "snowball";
  loanSource: "none" | "product" | "custom";
  choiceId: string;
  amount: string;
  debtIds: string[];
  lender: string;
  customRate: string;
  customTerm: string;
  customMax: string;
  extras: ExtraRow[];
};

export function Workspace({ householdId, compare }: { householdId: string; compare: string }) {
  const router = useRouter();
  const cases = useDemoStore((state) => state.cases);
  const scenarios = useDemoStore((state) => state.scenarios);
  const overrides = useDemoStore((state) => state.caseOverrides);
  const extraPayments = useDemoStore((state) => state.extraPayments);
  const customLoans = useDemoStore((state) => state.customLoans);
  const startCase = useDemoStore((state) => state.startCase);
  const addScenario = useDemoStore((state) => state.addScenario);
  const updateScenario = useDemoStore((state) => state.updateScenario);
  const removeScenario = useDemoStore((state) => state.removeScenario);
  const addExtraPayment = useDemoStore((state) => state.addExtraPayment);
  const addCustomLoan = useDemoStore((state) => state.addCustomLoan);

  const caseId = useMemo(() => {
    const matches = cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1]?.case_id ?? null;
  }, [cases, householdId]);

  const kept = useKeptResult(
    () => workspaceFor(householdId, caseId, { overrides, extraPayments, customLoans }, scenarios),
    [householdId, caseId, overrides, extraPayments, customLoans, scenarios],
  );
  const model = kept.value;

  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [builder, setBuilder] = useState<Builder>(() => blankBuilder(""));
  const [error, setError] = useState<string | null>(null);

  const draft = useMemo(() => (model ? draftFrom(builder, model) : null), [builder, model]);
  const keptPreview = useKeptResult(() => {
    if (!draft) return null;
    return previewHousehold(householdId, caseId ?? "draft", { overrides, extraPayments, customLoans }, draft);
  }, [draft, householdId, caseId, overrides, extraPayments, customLoans]);
  const preview = keptPreview.value;

  if (!model && kept.failed) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Household {householdId}</h1>
        <StaleNotice failed stale={kept.stale} onRetry={kept.retry} />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Household {householdId}</h1>
        <p className="text-sm text-muted-foreground">This household is not in the book.</p>
      </div>
    );
  }

  const compareIds = compare.split(",").map((id) => id.trim()).filter((id) => id !== "");
  if (compareIds.length > 0) {
    return <CompareView householdId={householdId} selectedIds={compareIds} />;
  }

  const builtIn = model.cards.filter((card) => card.kind === "builtin");
  const advisor = model.cards.filter((card) => card.kind === "advisor");
  const noProducts = model.choices.length === 0;

  function toggleCompare(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((row) => row !== id);
      if (current.length >= COMPARE_LIMIT) return current;
      return [...current, id];
    });
  }

  function openNew() {
    const first = model?.choices[0];
    setBuilder(blankBuilder(first?.id ?? ""));
    setError(null);
    setOpen(true);
  }

  function openEdit(scenario: Scenario) {
    if (!model) return;
    const choice = model.choices.find(
      (row) => row.product === scenario.product && row.termMonths === scenario.term_months,
    );
    const ids = (scenario.extra_payment_ids ?? "").split(";").filter((id) => id !== "");
    const loan = customLoans.find(
      (row) =>
        row.case_id === scenario.case_id &&
        row.rate === scenario.loan_rate &&
        row.term_months === scenario.term_months,
    );
    setBuilder({
      scenarioId: scenario.scenario_id,
      name: scenario.name,
      nameTouched: true,
      strategy: scenario.strategy === "snowball" ? "snowball" : "avalanche",
      loanSource: scenario.loan_source,
      choiceId: choice?.id ?? model.choices[0]?.id ?? "",
      amount: scenario.loan_amount ? String(scenario.loan_amount) : "",
      debtIds: (scenario.debts_paid_off ?? "").split(";").filter((id) => id !== ""),
      lender: loan?.lender_name ?? "",
      customRate: scenario.loan_rate == null ? "" : String(scenario.loan_rate),
      customTerm: scenario.term_months == null ? "" : String(scenario.term_months),
      customMax: loan ? String(loan.max_amount) : scenario.loan_amount ? String(scenario.loan_amount) : "",
      extras: ids.flatMap((id) => {
        const extra = extraPayments.find((row) => row.extra_id === id);
        if (!extra) return [];
        return [{ key: id, id, type: extra.type, amount: String(extra.amount), month: extra.start_month }];
      }),
    });
    setError(null);
    setOpen(true);
  }

  function applyChoice(choice: OfferChoice, current: Builder): Builder {
    return {
      ...current,
      choiceId: choice.id,
      amount: String(choice.amount),
      debtIds: choice.debtIds,
      name: current.nameTouched ? current.name : choice.label,
    };
  }

  function save() {
    if (!model || !draft) return;
    const message = validate(builder, model, draft);
    if (message) {
      setError(message);
      return;
    }
    const opened = startCase(householdId);
    const extraIds = draft.extras.map((extra) => {
      if (extra.id) return extra.id;
      return addExtraPayment({
        caseId: opened,
        householdId,
        type: extra.type,
        amount: extra.amount,
        startMonth: extra.startMonth,
        reason: "Added with this scenario",
      });
    });
    if (draft.loanSource === "custom" && draft.loanRate != null && draft.termMonths != null) {
      addCustomLoan({
        caseId: opened,
        householdId,
        lenderName: builder.lender.trim(),
        rate: draft.loanRate,
        termMonths: draft.termMonths,
        maxAmount: Number(builder.customMax),
      });
    }
    const fields = {
      name: draft.name,
      strategy: draft.strategy,
      loan_source: draft.loanSource,
      product: draft.loanSource === "product" ? draft.product : null,
      term_months: draft.loanSource === "none" ? null : draft.termMonths,
      loan_amount: draft.loanSource === "none" ? 0 : draft.loanAmount,
      loan_rate: draft.loanSource === "none" ? null : draft.loanRate,
      debts_paid_off: draft.loanSource === "none" ? null : draft.debtIds.join(";") || null,
      extra_payment_ids: extraIds.join(";") || null,
    };
    if (builder.scenarioId) updateScenario(builder.scenarioId, fields);
    else {
      addScenario({
        caseId: opened,
        householdId,
        name: fields.name,
        strategy: fields.strategy,
        loanSource: fields.loan_source,
        product: fields.product,
        termMonths: fields.term_months,
        loanAmount: fields.loan_amount,
        loanRate: fields.loan_rate,
        debtsPaidOff: fields.debts_paid_off,
        extraPaymentIds: fields.extra_payment_ids,
      });
    }
    setOpen(false);
    toast.success("Scenario saved");
  }

  const choice = model.choices.find((row) => row.id === builder.choiceId) ?? null;
  const productNames = [...new Set(model.choices.map((row) => row.product))];
  const termChoices = model.choices.filter((row) => row.product === (choice?.product ?? productNames[0]));
  const shownDebts = model.debts.filter((debt) => !debt.propertyId || debt.propertyId === choice?.propertyId);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">S3</p>
          <h1 className="text-2xl font-semibold tracking-tight">{model.name}</h1>
          <div className="flex gap-3">
            <Link href={`/households/${householdId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              Household overview
            </Link>
            <Link href={`/households/${householdId}/present`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              Present
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openNew}>
            New scenario
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => router.push(`/households/${householdId}/workspace?compare=${selected.join(",")}`)}
          >
            Compare{selected.length > 0 ? ` ${selected.length}` : ""}
          </Button>
        </div>
      </header>

      <p className="text-sm text-muted-foreground">Select up to {COMPARE_LIMIT} scenarios to compare.</p>

      {noProducts ? (
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
          <p>No product is eligible. Avalanche and snowball are the plans without a loan.</p>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {model.gaps.map((gap) => (
              <li key={gap.product}>
                {gap.product}: {gap.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Built-in scenarios</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {builtIn.map((card) => (
            <ScenarioCardView
              key={card.id}
              card={card}
              selected={selected.includes(card.id)}
              disabled={selected.length >= COMPARE_LIMIT && !selected.includes(card.id)}
              onCompare={() => toggleCompare(card.id)}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Your scenarios</h2>
        {advisor.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scenarios yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {advisor.map((card) => {
              const scenario = scenarios.find((row) => row.scenario_id === card.scenarioId);
              return (
                <ScenarioCardView
                  key={card.id}
                  card={card}
                  selected={selected.includes(card.id)}
                  disabled={selected.length >= COMPARE_LIMIT && !selected.includes(card.id)}
                  onCompare={() => toggleCompare(card.id)}
                  onEdit={scenario ? () => openEdit(scenario) : undefined}
                  onRemove={card.scenarioId ? () => removeScenario(card.scenarioId!) : undefined}
                />
              );
            })}
          </div>
        )}
      </section>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg" style={{ maxWidth: "36rem" }}>
          <SheetHeader>
            <SheetTitle>{builder.scenarioId ? "Edit scenario" : "New scenario"}</SheetTitle>
            <SheetDescription>Changes recalculate before you save them.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <Field label="Name">
              <Input
                value={builder.name}
                onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value, nameTouched: true }))}
              />
            </Field>
            <Field label="Strategy">
              <RadioGroup
                value={builder.strategy}
                onValueChange={(value) => {
                  if (value === "avalanche" || value === "snowball") {
                    setBuilder((current) => ({
                      ...current,
                      strategy: value,
                      name: current.nameTouched || current.loanSource !== "none" ? current.name : value === "avalanche" ? "Avalanche" : "Snowball",
                    }));
                  }
                }}
                className="grid grid-cols-2"
              >
                <Choice value="avalanche" label="Avalanche" />
                <Choice value="snowball" label="Snowball" />
              </RadioGroup>
            </Field>
            <Field label="Loan">
              <RadioGroup
                value={builder.loanSource}
                onValueChange={(value) => {
                  if (value !== "none" && value !== "product" && value !== "custom") return;
                  setBuilder((current) => {
                    if (value !== "product") {
                      const name = current.nameTouched
                        ? current.name
                        : value === "custom"
                          ? "Custom loan"
                          : current.strategy === "avalanche"
                            ? "Avalanche"
                            : "Snowball";
                      return { ...current, loanSource: value, name };
                    }
                    const next = model.choices.find((row) => row.id === current.choiceId) ?? model.choices[0];
                    if (!next) return { ...current, loanSource: value };
                    return applyChoice(next, { ...current, loanSource: value });
                  });
                }}
                className="grid gap-2"
              >
                <Choice value="none" label="No loan" />
                <Choice value="product" label="Catalogue product" />
                <Choice value="custom" label="Custom loan" />
              </RadioGroup>
            </Field>

            {builder.loanSource === "product" ? (
              <>
                <Field label="Product">
                  <Select
                    items={Object.fromEntries(productNames.map((name) => [name, name]))}
                    value={choice?.product ?? ""}
                    onValueChange={(value) => {
                      if (!value) return;
                      const next = model.choices.find((row) => row.product === value);
                      if (!next) return;
                      setBuilder((current) => applyChoice(next, current));
                    }}
                  >
                    <SelectTrigger aria-label="Product">
                      <SelectValue placeholder="Choose a product" />
                    </SelectTrigger>
                    <SelectContent>
                      {productNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Term">
                  <Select
                    items={Object.fromEntries(termChoices.map((row) => [row.id, row.label]))}
                    value={choice?.id ?? ""}
                    onValueChange={(value) => {
                      const next = model.choices.find((row) => row.id === value);
                      if (!next) return;
                      setBuilder((current) => applyChoice(next, current));
                    }}
                  >
                    <SelectTrigger aria-label="Term">
                      <SelectValue placeholder="Choose a term" />
                    </SelectTrigger>
                    <SelectContent>
                      {termChoices.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {model.gaps.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {model.gaps.map((gap) => (
                      <li key={gap.product}>
                        {gap.product}: {gap.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}

            {builder.loanSource === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Lender">
                  <Input value={builder.lender} onChange={(event) => setBuilder((current) => ({ ...current, lender: event.target.value }))} />
                </Field>
                <Field label="Rate">
                  <Input inputMode="decimal" value={builder.customRate} onChange={(event) => setBuilder((current) => ({ ...current, customRate: event.target.value }))} />
                </Field>
                <Field label="Term in months">
                  <Input inputMode="numeric" value={builder.customTerm} onChange={(event) => setBuilder((current) => ({ ...current, customTerm: event.target.value }))} />
                </Field>
                <Field label="Maximum amount">
                  <Input inputMode="decimal" value={builder.customMax} onChange={(event) => setBuilder((current) => ({ ...current, customMax: event.target.value }))} />
                </Field>
              </div>
            ) : null}

            {builder.loanSource !== "none" ? (
              <>
                <Field label="Amount">
                  <Input
                    inputMode="decimal"
                    value={builder.amount}
                    onChange={(event) => setBuilder((current) => ({ ...current, amount: event.target.value }))}
                  />
                </Field>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm text-muted-foreground">Debts to move</legend>
                  {shownDebts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No debt can be moved into a loan.</p>
                  ) : (
                    shownDebts.map((debt) => (
                      <label key={debt.debtId} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={builder.debtIds.includes(debt.debtId)}
                          onCheckedChange={(checked) => {
                            setBuilder((current) => {
                              const debtIds = checked
                                ? [...current.debtIds, debt.debtId]
                                : current.debtIds.filter((id) => id !== debt.debtId);
                              const amount = model.debts
                                .filter((row) => debtIds.includes(row.debtId))
                                .reduce((sum, row) => sum + row.balance, 0);
                              return { ...current, debtIds, amount: String(Math.round(amount)) };
                            });
                          }}
                        />
                        <span>
                          {debt.name} · {debt.balanceText} · {rateText(debt.rate)}
                          {debt.mandatory ? " · on the property" : ""}
                        </span>
                      </label>
                    ))
                  )}
                </fieldset>
              </>
            ) : null}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Extra payments</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addExtra("one_off")}>
                    Add one-off
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addExtra("recurring")}>
                    Add recurring
                  </Button>
                </div>
              </div>
              {builder.extras.map((extra) => (
                <div key={extra.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label={extra.type === "one_off" ? "One-off amount" : "Monthly amount"}>
                    <Input
                      inputMode="decimal"
                      value={extra.amount}
                      onChange={(event) => updateExtra(extra.key, { amount: event.target.value })}
                    />
                  </Field>
                  <Field label={extra.type === "one_off" ? "Month" : "Start month"}>
                    <Input
                      type="month"
                      min={PLAN_START}
                      value={extra.month}
                      onChange={(event) => updateExtra(extra.key, { month: event.target.value })}
                    />
                  </Field>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setBuilder((current) => ({ ...current, extras: current.extras.filter((row) => row.key !== extra.key) }))}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            {keptPreview.failed ? (
              <StaleNotice failed stale={keptPreview.stale} onRetry={keptPreview.retry} />
            ) : null}
            {preview ? <Preview preview={preview} /> : null}
            {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
          </div>
          <SheetFooter>
            <Button onClick={save}>Save scenario</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );

  function addExtra(type: ExtraRow["type"]) {
    setBuilder((current) => ({
      ...current,
      extras: [...current.extras, { key: `${type}-${current.extras.length}-${Date.now()}`, id: null, type, amount: "", month: PLAN_START }],
    }));
  }

  function updateExtra(key: string, patch: Partial<ExtraRow>) {
    setBuilder((current) => ({
      ...current,
      extras: current.extras.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  }
}

function blankBuilder(choiceId: string): Builder {
  return {
    scenarioId: null,
    name: "Avalanche",
    nameTouched: false,
    strategy: "avalanche",
    loanSource: "none",
    choiceId,
    amount: "",
    debtIds: [],
    lender: "",
    customRate: "",
    customTerm: "",
    customMax: "",
    extras: [],
  };
}

function finite(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftFrom(builder: Builder, model: WorkspaceModel): ScenarioDraft | null {
  const choice = model.choices.find((row) => row.id === builder.choiceId) ?? null;
  const extras = builder.extras.flatMap((extra) => {
    const amount = finite(extra.amount);
    if (amount == null || amount <= 0 || !/^\d{4}-\d{2}$/.test(extra.month)) return [];
    return [{ id: extra.id, type: extra.type, amount, startMonth: extra.month }];
  });
  if (builder.loanSource === "product" && choice) {
    return {
      name: builder.name.trim() || choice.label,
      strategy: builder.strategy,
      loanSource: "product",
      product: choice.product,
      termMonths: choice.termMonths,
      loanAmount: finite(builder.amount) ?? 0,
      loanRate: choice.rate,
      debtIds: builder.debtIds,
      extras,
    };
  }
  if (builder.loanSource === "custom") {
    return {
      name: builder.name.trim() || "Custom loan",
      strategy: builder.strategy,
      loanSource: "custom",
      product: null,
      termMonths: finite(builder.customTerm),
      loanAmount: finite(builder.amount) ?? 0,
      loanRate: finite(builder.customRate),
      debtIds: builder.debtIds,
      extras,
    };
  }
  return {
    name: builder.name.trim() || (builder.strategy === "avalanche" ? "Avalanche" : "Snowball"),
    strategy: builder.strategy,
    loanSource: "none",
    product: null,
    termMonths: null,
    loanAmount: 0,
    loanRate: null,
    debtIds: [],
    extras,
  };
}

function validate(builder: Builder, model: WorkspaceModel, draft: ScenarioDraft): string | null {
  if (!draft.name.trim()) return "Enter a name.";
  if (builder.loanSource === "product" && !model.choices.some((row) => row.id === builder.choiceId)) {
    return "Choose an eligible product and term.";
  }
  if (builder.loanSource === "custom") {
    if (!builder.lender.trim()) return "Enter the lender.";
    if (draft.loanRate == null || draft.loanRate < 0) return "Enter the rate.";
    if (draft.termMonths == null || draft.termMonths <= 0) return "Enter the term.";
    const max = finite(builder.customMax);
    if (max == null || max <= 0) return "Enter the maximum amount.";
    if (draft.loanAmount > max) return "The amount is above the maximum.";
  }
  if (builder.loanSource !== "none" && draft.loanAmount < 0) return "Enter an amount.";
  for (const extra of builder.extras) {
    if (extra.month < PLAN_START) return "Choose a month from Dec 2026.";
  }
  return null;
}

function ScenarioCardView({
  card,
  selected,
  disabled,
  onCompare,
  onEdit,
  onRemove,
}: {
  card: ScenarioCard;
  selected: boolean;
  disabled: boolean;
  onCompare: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <article data-scenario={card.name} className="flex flex-col gap-2 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium">{card.name}</h3>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={selected} disabled={disabled} onCheckedChange={onCompare} aria-label={`Compare ${card.name}`} />
          Compare
        </label>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Debt-free in</dt>
        <dd>{card.debtFree}</dd>
        <dt className="text-muted-foreground">Total interest</dt>
        <dd>{card.interest}</dd>
        <dt className="text-muted-foreground">Months saved</dt>
        <dd>{card.monthsSaved}</dd>
        <dt className="text-muted-foreground">Monthly payment</dt>
        <dd>{card.monthly}</dd>
      </dl>
      <AlertBadge alert={card.alert} label={card.alertLabel} />
      {card.note ? <p>{card.note}</p> : null}
      {card.labels.length > 0 ? <p className="text-muted-foreground">{card.labels.join(" · ")}</p> : null}
      {onEdit || onRemove ? (
        <div className="flex gap-2">
          {onEdit ? (
            <Button variant="ghost" size="xs" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          {onRemove ? (
            <Button variant="ghost" size="xs" onClick={onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function AlertBadge({ alert, label }: { alert: PaymentAlert; label: string }) {
  if (alert === "none") return <span className="text-sm text-muted-foreground">{label}</span>;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
        alert === "red" ? "bg-payment-red text-payment-red-foreground" : "bg-payment-amber text-payment-amber-foreground",
      )}
    >
      {label}
    </span>
  );
}

function Preview({ preview }: { preview: DraftPreview }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/60 p-3 text-sm" data-testid="scenario-preview">
      <p className="font-medium">This plan</p>
      <p>Debt-free in {preview.debtFree}</p>
      <p>Total interest {preview.interest}</p>
      <p>Monthly payment {preview.monthly}</p>
      <AlertBadge alert={preview.alert} label={preview.alertLabel} />
      {preview.note ? <p>{preview.note}</p> : null}
      {preview.labels.length > 0 ? <p className="text-muted-foreground">{preview.labels.join(" · ")}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Choice({ value, label }: { value: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <RadioGroupItem value={value} />
      {label}
    </label>
  );
}
