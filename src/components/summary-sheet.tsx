"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { FrozenSnapshot } from "@/lib/snapshot";
import { useDemoStore } from "@/lib/store";

const ESTIMATED = "Figures are estimated.";

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
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        .pdf-summary { break-after: page; page-break-after: always; }
        .pdf-year { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          .pdf-summary { break-after: page; page-break-after: always; }
        }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Download the household&apos;s PDF</h1>
          <Link href={`/households/${householdId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Back to the household
          </Link>
        </div>
        <Button onClick={() => window.print()}>Download the household&apos;s PDF</Button>
      </div>
      <Pdf snapshot={snapshot} />
    </div>
  );
}

function Pdf({ snapshot }: { snapshot: FrozenSnapshot }) {
  const advantages = snapshot.advantages ?? [];
  const things = snapshot.thingsToKnow ?? [];
  const years = snapshot.years ?? [];
  const excluded = new Set((snapshot.leftOut ?? []).map((name) => `${name} is not included in this plan.`));
  const notes = things.filter((line) => line !== ESTIMATED && !excluded.has(line));

  return (
    <div className="bg-white text-[12px] leading-snug text-neutral-900">
      <article className="pdf-summary flex flex-col gap-3 p-6 shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-end justify-between gap-4 border-b border-neutral-300 pb-2">
          <div>
            <p className="text-[11px] text-neutral-500">{snapshot.name}</p>
            <h2 className="text-xl font-semibold tracking-tight">{snapshot.planName || snapshot.name}</h2>
          </div>
          <p className="text-right">
            {snapshot.advisor}
            <br />
            {formatDate(snapshot.frozen_at)}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-4">
          <section>
            <h3 className="text-[11px] font-medium text-neutral-500">Today</h3>
            <p className="mt-1">Debt free by {snapshot.today.debtFree}</p>
            <p>Total interest {snapshot.today.interest}</p>
            <p>Monthly payment {snapshot.today.monthly}</p>
          </section>
          <section>
            <h3 className="text-[11px] font-medium text-neutral-500">Your plan</h3>
            <p className="mt-1">Debt free by {snapshot.plan.debtFree}</p>
            <p>Total interest {snapshot.plan.interest}</p>
            <p>Interest saved {snapshot.interestSaved}</p>
            <p>Monthly payment {snapshot.plan.monthly}</p>
            <p>{snapshot.monthsSooner}</p>
          </section>
        </div>

        <section>
          <h3 className="text-[11px] font-medium text-neutral-500">Order your debts are paid off</h3>
          {snapshot.payoff.length === 0 ? (
            <p>{snapshot.plan.debtFree}</p>
          ) : (
            <ol className="mt-1 list-decimal columns-2 gap-6 pl-4">
              {snapshot.payoff.map((step, index) => (
                <li key={`${step.name}-${index}`} className="break-inside-avoid">
                  {step.name} — {step.when}
                </li>
              ))}
            </ol>
          )}
        </section>

        {snapshot.loan ? <p>{snapshot.loan}</p> : null}

        {advantages.length > 0 ? (
          <section>
            <h3 className="text-[11px] font-medium text-neutral-500">What&apos;s good about this plan</h3>
            <ul className="mt-1 list-disc pl-4">
              {advantages.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {notes.length > 0 ? (
          <section>
            <h3 className="text-[11px] font-medium text-neutral-500">Things to know</h3>
            <ul className="mt-1 list-disc pl-4">
              {notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {snapshot.leftOut.length > 0 ? (
          <section>
            <h3 className="text-[11px] font-medium text-neutral-500">Not included</h3>
            <ul className="mt-1 list-disc pl-4">
              {snapshot.leftOut.map((name) => (
                <li key={name}>{name} is not included in this plan.</li>
              ))}
            </ul>
          </section>
        ) : null}

        {snapshot.estimated ? <p>{ESTIMATED}</p> : null}
        <p className="border-t border-neutral-300 pt-2 text-[11px] text-neutral-600">{snapshot.note}</p>
      </article>

      {years.length > 0 ? (
        <section className="flex flex-col gap-4 p-6 print:p-0">
          <h2 className="text-lg font-semibold">Month by month</h2>
          {years.map((year) => (
            <div key={year.year} className="pdf-year">
              <h3 className="mb-1 text-base font-semibold">{year.year}</h3>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-neutral-300 text-[11px] text-neutral-500">
                    <th className="py-1 pr-2 font-medium">Month</th>
                    <th className="py-1 pr-2 font-medium">Payment</th>
                    <th className="py-1 pr-2 font-medium">Interest</th>
                    <th className="py-1 pr-2 font-medium">Balance</th>
                    <th className="py-1 font-medium">Debts cleared</th>
                  </tr>
                </thead>
                <tbody>
                  {year.months.map((month) => (
                    <tr key={month.label} className="border-b border-neutral-200 break-inside-avoid">
                      <td className="py-0.5 pr-2">{month.label}</td>
                      <td className="py-0.5 pr-2">{month.payment}</td>
                      <td className="py-0.5 pr-2">{month.interest}</td>
                      <td className="py-0.5 pr-2">{month.balance}</td>
                      <td className="py-0.5">{month.cleared}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
