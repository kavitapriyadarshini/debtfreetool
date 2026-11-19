"use client";

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StaleNotice, useKeptResult } from "@/components/kept-result";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { ActionBar, actionBarOffset } from "@/components/action-bar";
import { Profile } from "@/components/profile";
import { SavingsText } from "@/components/savings-text";
import { CompareView } from "@/components/compare-view";
import { PLAN_START } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { useDemoStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  DUPLICATE_EXCLUDED,
  headerBadges,
  identicalPlan,
  LOAN_MOVES_NOTHING,
  paymentRule,
  paymentSummary,
  planSource,
  previewHousehold,
  rateText,
  reservedPlanNames,
  scenarioNameError,
  workspaceFor,
  type DraftPreview,
  type OfferChoice,
  type ScenarioCard,
  type ScenarioDraft,
  type WorkspaceModel,
} from "@/lib/workspace";
import { PaymentDot } from "@/components/payment-dot";
import type { Scenario } from "@/lib/types";

const COMPARE_PICKS = 3;

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
  /** A built-in plan opened as a new scenario, saved under Built by you. */
  copy: boolean;
};

export function Workspace({
  householdId,
  compare,
  notice = false,
}: {
  householdId: string;
  compare: string;
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
  const updateScenario = useDemoStore((state) => state.updateScenario);
  const removeScenario = useDemoStore((state) => state.removeScenario);
  const addExtraPayment = useDemoStore((state) => state.addExtraPayment);
  const addCustomLoan = useDemoStore((state) => state.addCustomLoan);

  const caseId = useMemo(() => {
    const matches = cases.filter((row) => row.household_id === householdId);
    return matches[matches.length - 1]?.case_id ?? null;
  }, [cases, householdId]);
  const recommendedScenarioId = cases.find((row) => row.case_id === caseId)?.recommended_scenario_id ?? null;

  const kept = useKeptResult(
    () => workspaceFor(householdId, caseId, { overrides, extraPayments, customLoans }, scenarios, recommendedScenarioId),
    [householdId, caseId, overrides, extraPayments, customLoans, scenarios, recommendedScenarioId],
  );
  const model = kept.value;

  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [builder, setBuilder] = useState<Builder>(() => blankBuilder(""));
  const [previewBuilder, setPreviewBuilder] = useState<Builder>(() => blankBuilder(""));
  const [error, setError] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [debtsOpen, setDebtsOpen] = useState(true);
  const [moneyOpen, setMoneyOpen] = useState(true);
  const [explained, setExplained] = useState<ScenarioCard | null>(null);
  const numbers = numberKey(builder);
  const shape = shapeKey(builder);

  useEffect(() => {
    setPreviewBuilder(builder);
    // Shape changes (product, term, debts, strategy) update the preview immediately.
    // `builder` is the value from this render; listing it would also fire on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewBuilder(builder), 150);
    return () => window.clearTimeout(timer);
    // Number fields wait 150ms so a keystroke does not recalculate on every digit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbers]);

  const columns = useMemo(() => {
    if (!model) return [];
    const today = model.cards.filter((card) => card.origin === "today");
    const nightly = model.cards.filter((card) => card.nightly && card.origin !== "today");
    const builtIn = model.cards.filter((card) => card.origin === "builtin" && !card.nightly);
    const advisor = model.cards.filter((card) => card.origin === "advisor");
    return [...today, ...nightly, ...builtIn, ...advisor];
  }, [model]);
  const actions = useRef({
    compare: (_id: string) => {},
    open: (_card: ScenarioCard) => {},
    explain: (_card: ScenarioCard) => {},
    remove: (_id: string) => {},
    toggleDebts: () => {},
    toggleMoney: () => {},
  });
  const onCompare = useCallback((id: string) => actions.current.compare(id), []);
  const onOpen = useCallback((card: ScenarioCard) => actions.current.open(card), []);
  const onExplain = useCallback((card: ScenarioCard) => actions.current.explain(card), []);
  const onRemove = useCallback((id: string) => actions.current.remove(id), []);
  const onToggleDebts = useCallback(() => actions.current.toggleDebts(), []);
  const onToggleMoney = useCallback(() => actions.current.toggleMoney(), []);

  useEffect(() => {
    router.prefetch(`/households/${householdId}/present`);
    router.prefetch(`/households/${householdId}/summary`);
  }, [router, householdId]);

  useEffect(() => {
    const ids = selected.filter((id) => id !== "current");
    if (ids.length < 1) return;
    router.prefetch(`/households/${householdId}/workspace?compare=${ids.join(",")}`);
  }, [router, householdId, selected]);

  const draft = useMemo(() => (model ? draftFrom(previewBuilder, model) : null), [previewBuilder, model]);
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
  if (compareIds.length > 0 || notice) {
    return (
      <CompareView
        householdId={householdId}
        householdName={model.name}
        selectedIds={compareIds.length > 0 ? compareIds : ["current"]}
        notice={notice}
      />
    );
  }

  const today = model.cards.filter((card) => card.origin === "today");
  const nightly = model.cards.filter((card) => card.nightly && card.origin !== "today");
  const builtIn = model.cards.filter((card) => card.origin === "builtin" && !card.nightly);
  const advisor = model.cards.filter((card) => card.origin === "advisor");
  const noProducts = model.choices.length === 0;

  function toggleCompare(id: string) {
    if (id === "current") return;
    startTransition(() => setSelected((current) => {
      const picked = current.filter((row) => row !== "current");
      if (picked.includes(id)) return picked.filter((row) => row !== id);
      if (picked.length >= COMPARE_PICKS) return picked;
      return [...picked, id];
    }));
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
      copy: false,
      extras: ids.flatMap((id) => {
        const extra = extraPayments.find((row) => row.extra_id === id);
        if (!extra) return [];
        return [{ key: id, id, type: extra.type, amount: String(extra.amount), month: extra.start_month }];
      }),
    });
    setError(null);
    setOpen(true);
  }

  function openCopy(card: ScenarioCard) {
    if (!model) return;
    const choice = model.choices.find((row) => row.id === card.id);
    const blank = blankBuilder(choice?.id ?? model.choices[0]?.id ?? "");
    if (choice) {
      setBuilder({
        ...blank,
        name: choice.label,
        nameTouched: true,
        strategy: "avalanche",
        loanSource: "product",
        choiceId: choice.id,
        amount: String(choice.amount),
        debtIds: choice.debtIds,
        copy: true,
      });
    } else {
      setBuilder({
        ...blank,
        name: card.name,
        nameTouched: true,
        strategy: card.id === "snowball" ? "snowball" : "avalanche",
        loanSource: "none",
        copy: true,
      });
    }
    setError(null);
    setOpen(true);
  }

  function openPlan(card: ScenarioCard) {
    if (card.scenarioId) {
      const scenario = scenarios.find((row) => row.scenario_id === card.scenarioId);
      if (scenario) {
        openEdit(scenario);
        return;
      }
    }
    openCopy(card);
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
    if (!model) return;
    const saving = draftFrom(builder, model);
    if (!saving) return;
    const message = validate(builder, model, saving, takenNames);
    if (message) {
      setError(message);
      return;
    }
    const opened = startCase(householdId);
    const extraIds = saving.extras.map((extra) => {
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
    if (saving.loanSource === "custom" && saving.loanRate != null && saving.termMonths != null) {
      addCustomLoan({
        caseId: opened,
        householdId,
        lenderName: builder.lender.trim(),
        rate: saving.loanRate,
        termMonths: saving.termMonths,
        maxAmount: Number(builder.customMax),
      });
    }
    const fields = {
      name: saving.name,
      strategy: saving.strategy,
      loan_source: saving.loanSource,
      product: saving.loanSource === "product" ? saving.product : null,
      term_months: saving.loanSource === "none" ? null : saving.termMonths,
      loan_amount: saving.loanSource === "none" ? 0 : saving.loanAmount,
      loan_rate: saving.loanSource === "none" ? null : saving.loanRate,
      debts_paid_off: saving.loanSource === "none" ? null : saving.debtIds.join(";") || null,
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
  const takenNames = reservedPlanNames(
    model.choices,
    scenarios.filter((row) => row.case_id === caseId),
    builder.scenarioId,
  );
  const nameError = scenarioNameError(builder.name, takenNames);
  const liveDraft = draftFrom(builder, model);
  const sameAs = liveDraft ? identicalPlan(liveDraft, model.cards, builder.scenarioId) : null;
  const productNames = [...new Set(model.choices.map((row) => row.product))];
  const termChoices = model.choices.filter((row) => row.product === (choice?.product ?? productNames[0]));
  const shownDebts = model.debts.filter((debt) => !debt.propertyId || debt.propertyId === choice?.propertyId);
  actions.current = {
    compare: toggleCompare,
    open: openPlan,
    explain: setExplained,
    remove: (id) => removeScenario(id),
    toggleDebts: () => setDebtsOpen((open) => !open),
    toggleMoney: () => setMoneyOpen((open) => !open),
  };

  return (
    <Profile id="workspace">
    <div className={cn("flex min-w-0 flex-col gap-6", actionBarOffset, "pb-56")}>
      <StaleNotice failed={kept.failed} stale={kept.stale} onRetry={kept.retry} />
      <header>
        <p className="text-xs font-medium tracking-wide text-muted-foreground">S3</p>
        <h1 className="text-2xl font-semibold tracking-tight">{model.name}</h1>
        <p className="text-sm text-muted-foreground">Scenarios</p>
        <Link href={`/households/${householdId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          Household overview
        </Link>
      </header>

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

      <PlanTable
        columns={columns}
        debts={model.debtRows}
        debtsOpen={debtsOpen}
        moneyOpen={moneyOpen}
        selected={selected}
        note={model.comparableNote}
        onToggleDebts={onToggleDebts}
        onToggleMoney={onToggleMoney}
        onCompare={onCompare}
        onOpen={onOpen}
        onExplain={onExplain}
        onRemove={onRemove}
      />

      {explained ? (
        <Sheet open onOpenChange={(next) => { if (!next) setExplained(null); }}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-lg" style={{ maxWidth: "36rem" }}>
            <SheetHeader>
              <SheetTitle>How this is calculated</SheetTitle>
              <SheetDescription>{explained.name}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
              <section className="flex flex-col gap-1">
                <h2 className="font-medium">Budget</h2>
                <p>{explained.monthly}</p>
              </section>
              <section className="flex flex-col gap-1">
                <h2 className="font-medium">Spare money</h2>
                <p>{explained.spare}</p>
              </section>
              <section className="flex flex-col gap-1">
                <h2 className="font-medium">Payoff events</h2>
                {explained.moneyGoes.length === 0 ? (
                  <p>No payment changes.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {explained.moneyGoes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {open ? <Sheet open onOpenChange={(next) => { if (!next) setOpen(false); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg" style={{ maxWidth: "36rem" }}>
          <SheetHeader>
            <SheetTitle>{builder.scenarioId ? "Edit scenario" : "New scenario"}</SheetTitle>
            <SheetDescription>
              {builder.copy
                ? "This is a copy. Saving stores it under Built by you."
                : "Changes recalculate before you save them."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <Field label="Name">
              <Input
                value={builder.name}
                aria-invalid={nameError != null}
                onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value, nameTouched: true }))}
              />
              {nameError ? (
                <p className="text-sm" role="alert">
                  {nameError}
                </p>
              ) : null}
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
                {builder.debtIds.length === 0 ? (
                  <p className="text-sm" role="alert">
                    {LOAN_MOVES_NOTHING}
                  </p>
                ) : null}
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
            {sameAs ? (
              <p className="text-sm" role="alert">
                Same as {sameAs}
              </p>
            ) : null}
            {error && error !== `Same as ${sameAs}` ? <p className="text-sm text-muted-foreground">{error}</p> : null}
          </div>
          <SheetFooter>
            <Button
              aria-busy={pressed === "save"}
              disabled={nameError != null || sameAs != null}
              onClick={() => {
                setPressed("save");
                window.setTimeout(() => {
                  save();
                  setPressed(null);
                }, 0);
              }}
            >
              {pressed === "save" ? "Saving…" : "Save scenario"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet> : null}
      <ActionBar
        name={model.name}
        banner={<PlanRule text={paymentRule(formatMoney(today[0]?.todayMonthly ?? 0))} />}
      >
        <Button
          variant="outline"
          aria-busy={pressed === "new"}
          onClick={() => {
            setPressed("new");
            window.setTimeout(() => {
              openNew();
              setPressed(null);
            }, 0);
          }}
        >
          {pressed === "new" ? "Opening…" : "New scenario"}
        </Button>
        <CompareButton
          count={selected.filter((id) => id !== "current").length}
          href={`/households/${householdId}/workspace?compare=${selected.filter((id) => id !== "current").join(",")}`}
        />
      </ActionBar>
    </div>
    </Profile>
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

function numberKey(builder: Builder): string {
  return [builder.amount, builder.customRate, builder.customTerm, builder.customMax, ...builder.extras.map((extra) => extra.amount)].join("|");
}

function shapeKey(builder: Builder): string {
  return [
    builder.strategy,
    builder.loanSource,
    builder.choiceId,
    builder.debtIds.join(","),
    builder.lender,
    ...builder.extras.map((extra) => `${extra.type}:${extra.month}:${extra.id ?? ""}`),
  ].join("|");
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
    copy: false,
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

function validate(
  builder: Builder,
  model: WorkspaceModel,
  draft: ScenarioDraft,
  taken: readonly string[],
): string | null {
  const same = identicalPlan(draft, model.cards, builder.scenarioId);
  if (same) return `Same as ${same}`;
  const nameError = scenarioNameError(builder.name, taken);
  if (nameError) return nameError;
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

const LABEL_CELL = "sticky left-0 z-20 box-border w-[168px] min-w-[168px] max-w-[168px] break-words border-b bg-background px-3 py-2 text-left align-top text-sm font-medium";
const TODAY_CELL = "sticky left-[168px] z-10 box-border w-[200px] min-w-[200px] max-w-[200px] break-words border-b bg-muted px-3 py-2 text-left align-top text-sm";
const PLAN_CELL = "box-border w-[200px] min-w-[200px] max-w-[200px] break-words border-b bg-background px-3 py-2 text-left align-top text-sm";
const COLUMN_SIDE = "shadow-[inset_2px_0_0_0_var(--foreground),inset_-2px_0_0_0_var(--foreground)]";
const COLUMN_TOP = "shadow-[inset_2px_0_0_0_var(--foreground),inset_-2px_0_0_0_var(--foreground),inset_0_2px_0_0_var(--foreground)]";
const COLUMN_BOTTOM = "shadow-[inset_2px_0_0_0_var(--foreground),inset_-2px_0_0_0_var(--foreground),inset_0_-2px_0_0_var(--foreground)]";

const PlanTable = memo(function PlanTable({
  columns,
  debts,
  debtsOpen,
  moneyOpen,
  selected,
  note,
  onToggleDebts,
  onToggleMoney,
  onCompare,
  onOpen,
  onExplain,
  onRemove,
}: {
  columns: ScenarioCard[];
  debts: WorkspaceModel["debtRows"];
  debtsOpen: boolean;
  moneyOpen: boolean;
  selected: string[];
  note: string | null;
  onToggleDebts: () => void;
  onToggleMoney: () => void;
  onCompare: (id: string) => void;
  onOpen: (card: ScenarioCard) => void;
  onExplain: (card: ScenarioCard) => void;
  onRemove: (scenarioId: string) => void;
}) {
  function cell(card: ScenarioCard, edge: "top" | "middle" | "bottom") {
    const picked = card.origin !== "today" && selected.includes(card.id);
    const outline = edge === "top" ? COLUMN_TOP : edge === "bottom" ? COLUMN_BOTTOM : COLUMN_SIDE;
    return cn(card.origin === "today" ? TODAY_CELL : PLAN_CELL, picked && outline);
  }

  const rows: { label: string; cell: (card: ScenarioCard) => ReactNode }[] = [
    { label: "Source", cell: (card) => <SourceBadges badges={[planSource(card)]} /> },
    { label: "Debt-free in", cell: (card) => card.debtFree },
    { label: "Months saved", cell: (card) => <SavingsText value={card.monthsSaved} reason={note} /> },
    { label: "Total interest", cell: (card) => <SavingsText value={card.interest} /> },
    { label: "Interest saved", cell: (card) => <SavingsText value={card.interestSaved} reason={note} /> },
    { label: "Monthly payment", cell: (card) => <PaymentCell monthly={card.monthly} /> },
    { label: "Payment alert", cell: (card) => <PaymentDot alert={card.alert} label={card.alertLabel} /> },
    {
      label: "Loan",
      cell: (card) => (
        <span>
          {card.loan}
          {card.labels.length > 0 ? <span className="block text-muted-foreground">{card.labels.join(" · ")}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="min-w-0 overflow-x-auto">
      <table
        className="border-separate border-spacing-0 text-sm"
        style={{ width: 168 + columns.length * 200 }}
      >
        <caption className="sr-only">Plans for this household. Tick up to 3 to compare. The current path is always included.</caption>
        <thead>
          <tr>
            <th className={LABEL_CELL} scope="col">
              Plan
            </th>
            {columns.map((card) => {
              const today = card.origin === "today";
              const ticked = !today && selected.includes(card.id);
              const blocked = !card.comparable;
              const picked = selected.filter((id) => id !== "current");
              const disabled = blocked || (picked.length >= COMPARE_PICKS && !ticked);
              return (
                <th key={card.id} className={cell(card, "top")} scope="col">
                  <div className="flex flex-col items-start gap-1">
                    {today ? (
                      <p className="text-sm text-muted-foreground">Always compared</p>
                    ) : (
                      <label
                        className="flex items-center gap-2"
                        onPointerDown={(event) => {
                          event.currentTarget.dataset.pending = "true";
                        }}
                      >
                        <Checkbox
                          checked={ticked}
                          disabled={disabled}
                          onCheckedChange={() => {
                            if (!blocked) onCompare(card.id);
                          }}
                          ref={(node: HTMLElement | null) => {
                            if (!node) return;
                            node.onfocus = () => {
                              node.style.outline = "2px solid var(--foreground)";
                              node.style.outlineOffset = "2px";
                            };
                            node.onblur = () => {
                              node.style.outline = "";
                              node.style.outlineOffset = "";
                            };
                          }}
                          aria-label={blocked ? `Compare ${card.name}. ${LOAN_MOVES_NOTHING}` : `Compare ${card.name}`}
                          className="size-5 rounded-[4px] border-2 border-foreground bg-background text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground data-checked:border-foreground data-checked:bg-foreground data-checked:text-background disabled:opacity-100"
                        />
                        <span className="text-sm">Compare</span>
                      </label>
                    )}
                    <PlanName name={card.name} onOpen={() => onOpen(card)} />
                    <HeaderBadges badges={card.badges} />
                    <button
                      type="button"
                      className="text-left text-xs text-muted-foreground hover:underline"
                      onClick={() => onExplain(card)}
                    >
                      How this is calculated
                    </button>
                    {card.note === LOAN_MOVES_NOTHING ? <p className="text-xs">{LOAN_MOVES_NOTHING}</p> : null}
                    {card.origin === "advisor" && card.scenarioId ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => onRemove(card.scenarioId!)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th className={LABEL_CELL} scope="row">
                {row.label}
              </th>
              {columns.map((card) => (
                <td key={card.id} className={cell(card, "middle")}>
                  {row.cell(card)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th className={LABEL_CELL} scope="row">
              <button
                type="button"
                className="font-medium hover:underline"
                aria-expanded={debtsOpen}
                onClick={onToggleDebts}
              >
                Debts
              </button>
            </th>
            {columns.map((card) => (
              <td key={card.id} className={cell(card, "middle")} />
            ))}
          </tr>
          {debtsOpen ? (
            <>
              {debts.map((debt) => (
                <tr key={debt.debtId}>
                  <th className={cn(LABEL_CELL, "pl-6 font-normal", debt.included ? "" : "text-muted-foreground")} scope="row">
                    {debt.duplicateExcluded ? (
                      <Tooltip>
                        <TooltipTrigger type="button" className="text-left underline decoration-dotted underline-offset-2">
                          {debt.name} · {debt.rate}
                        </TooltipTrigger>
                        <TooltipContent>{DUPLICATE_EXCLUDED}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span>{debt.name} · {debt.rate}</span>
                    )}
                    {debt.edits.map((line) => (
                      <span key={line} className="mt-1 block">{line}</span>
                    ))}
                    {debt.resolved ? <span className="mt-1 block text-muted-foreground">Resolved in this case</span> : null}
                  </th>
                  {columns.map((card) => (
                    <td
                      key={card.id}
                      className={cn(cell(card, "middle"), debt.included ? "" : "text-muted-foreground")}
                    >
                      {debt.included ? (card.debtWhen[debt.debtId] ?? "Never") : "Not included"}
                    </td>
                  ))}
                </tr>
              ))}
              {columns.some((card) => card.loanDebt) ? (
                <tr>
                  <th className={cn(LABEL_CELL, "pl-6 font-normal")} scope="row">
                    New loan
                  </th>
                  {columns.map((card) => (
                    <td key={card.id} className={cell(card, "middle")}>
                      {card.loanDebt ? (
                        <span className="flex flex-col gap-1">
                          <span>{card.loanDebt}</span>
                          <span>{card.debtWhen.NEW_LOAN}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                </tr>
              ) : null}
            </>
          ) : null}
          <tr>
            <th className={LABEL_CELL} scope="row">
              <button
                type="button"
                className="font-medium hover:underline"
                aria-expanded={moneyOpen}
                onClick={onToggleMoney}
              >
                Where the money goes
              </button>
            </th>
            {columns.map((card) => (
              <td key={card.id} className={cell(card, "bottom")}>
                {moneyOpen ? <MoneyCell lines={card.moneyGoes} /> : null}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
});

function CompareButton({ count, href }: { count: number; href: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={count < 1 || pending}
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
      onPointerDown={(event) => {
        event.currentTarget.dataset.pending = "true";
      }}
      onClick={() => {
        if (count < 1 || pending) return;
        setPending(true);
        startTransition(() => router.push(href));
      }}
    >
      {pending ? "Opening…" : `Compare ${count}`}
    </Button>
  );
}

function PlanRule({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t bg-background px-4 py-2" data-testid="plan-rule">
      <div className="flex items-start gap-3">
        <p id="plan-rule-text" className={cn("min-w-0 flex-1 text-sm text-muted-foreground", !open && "line-clamp-1")}>
          {text}
        </p>
        <button
          type="button"
          className="shrink-0 text-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          aria-expanded={open}
          aria-controls="plan-rule-text"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
    </div>
  );
}

function PlanName({ name, onOpen }: { name: string; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [name]);
  const className = "line-clamp-2 w-full break-words text-left font-medium hover:underline";
  if (!clipped) {
    return (
      <button ref={ref} type="button" className={className} onClick={onOpen}>
        {name}
      </button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger ref={ref} type="button" className={className} onClick={onOpen}>
        {name}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{name}</TooltipContent>
    </Tooltip>
  );
}

function DetailList({ items }: { items: string[] }) {
  return (
    <Popover>
      <PopoverTrigger type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
        Show all
      </PopoverTrigger>
      <PopoverContent>
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function PaymentCell({ monthly }: { monthly: string }) {
  const { summary, steps } = paymentSummary(monthly);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p>{summary}</p>
      {steps.length > 1 ? <DetailList items={steps} /> : null}
    </div>
  );
}

function MoneyCell({ lines }: { lines: string[] }) {
  if (lines.length === 0) return <p className="break-words">No payment changes.</p>;
  return (
    <ul className="flex w-full min-w-0 flex-col gap-1">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`} className="break-words whitespace-normal">
          {line}
        </li>
      ))}
    </ul>
  );
}

function HeaderBadges({ badges }: { badges: string[] }) {
  const marks = headerBadges(badges);
  if (marks.length === 0) return null;
  return <SourceBadges badges={marks} />;
}

function SourceBadges({ badges }: { badges: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
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
    </div>
  );
}

function Preview({ preview }: { preview: DraftPreview }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/60 p-3 text-sm" data-testid="scenario-preview">
      <p className="font-medium">This plan</p>
      <p>Debt-free in {preview.debtFree}</p>
      <p>Total interest {preview.interest}</p>
      <p>Monthly payment {preview.monthly}</p>
      <PaymentDot alert={preview.alert} label={preview.alertLabel} />
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
