"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { useDemoStore } from "@/lib/store";

export function SummarySheet({ householdId }: { householdId: string }) {
  const snapshots = useDemoStore((state) => state.snapshots ?? []);
  const snapshot = [...snapshots].reverse().find((row) => row.household_id === householdId) ?? null;

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Summary</h1>
        <p>No agreed plan has been saved for this household.</p>
        <Link href={`/households/${householdId}`} className="text-sm underline-offset-2 hover:underline">
          Back to the household
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[190mm]">
      <style>{`@page { size: A4 portrait; margin: 12mm; }`}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/households/${householdId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          Back to the household
        </Link>
        <Button onClick={() => window.print()}>Download PDF</Button>
      </div>
      <article
        id="one-pager"
        className="flex flex-col gap-3 bg-white p-6 text-[12.5px] leading-snug text-neutral-900 shadow-sm print:p-0 print:shadow-none"
      >
        <header className="flex items-end justify-between gap-4 border-b border-neutral-300 pb-2">
          <div>
            <p className="text-[11px] tracking-wide text-neutral-500">Debt Free</p>
            <h1 className="text-2xl font-semibold tracking-tight">{snapshot.name}</h1>
          </div>
          <p className="text-right text-[12px]">
            {snapshot.advisor}
            <br />
            {formatDate(snapshot.frozen_at)}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-4">
          <section>
            <h2 className="text-[11px] font-medium tracking-wide text-neutral-500">Today</h2>
            <p className="mt-1 text-lg font-semibold">{snapshot.today.debtFree}</p>
            <p>Total interest {snapshot.today.interest}</p>
            <p>Monthly payment {snapshot.today.monthly}</p>
          </section>
          <section>
            <h2 className="text-[11px] font-medium tracking-wide text-neutral-500">New plan</h2>
            <p className="mt-1 text-lg font-semibold">{snapshot.plan.debtFree}</p>
            <p>Total interest {snapshot.plan.interest}</p>
            <p>Monthly payment {snapshot.plan.monthly}</p>
            <p>Interest saved {snapshot.interestSaved}</p>
            <p>{snapshot.monthsSooner}</p>
          </section>
        </div>

        {snapshot.loan ? <p>{snapshot.loan}</p> : null}
        {snapshot.estimated ? <p>Credit score estimated</p> : null}

        <section>
          <h2 className="text-[11px] font-medium tracking-wide text-neutral-500">Payoff order</h2>
          {snapshot.payoff.length === 0 ? (
            <p>{snapshot.plan.debtFree}</p>
          ) : (
            <ol className="mt-1 columns-2 gap-6">
              {snapshot.payoff.map((step, index) => (
                <li key={`${step.name}-${index}`} className="break-inside-avoid">
                  {step.name} — {step.when}
                </li>
              ))}
            </ol>
          )}
        </section>

        {snapshot.leftOut.length > 0 ? (
          <p>{snapshot.leftOut.join(", ")} is not included in this plan.</p>
        ) : null}

        <p className="border-t border-neutral-300 pt-2 text-[11px] text-neutral-600">{snapshot.note}</p>
      </article>
    </div>
  );
}
