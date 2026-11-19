import {
  COLUMN_GAP_MM,
  LEFT_COLUMN_MM,
  ONE_PAGER_CSS,
  onePagerContent,
  RIGHT_COLUMN_MM,
  SHEET_HEIGHT_MM,
  SHEET_WIDTH_MM,
} from "@/lib/one-pager";
import { formatDate } from "@/lib/format";
import type { FrozenSnapshot } from "@/lib/snapshot";

/** The household one-pager. The same sheet is the on-screen preview and the print. */
export function OnePager({ snapshot }: { snapshot: FrozenSnapshot }) {
  const page = onePagerContent(snapshot);

  return (
    <article
      className="pdf-sheet bg-white text-neutral-900 shadow-sm print:shadow-none"
      data-testid="one-pager"
      data-point-size={page.schedulePoint}
      data-schedule-rows={page.schedule.length}
      style={{
        width: `${SHEET_WIDTH_MM}mm`,
        height: `${SHEET_HEIGHT_MM}mm`,
        gridTemplateColumns: `${LEFT_COLUMN_MM}mm ${RIGHT_COLUMN_MM}mm`,
        columnGap: `${COLUMN_GAP_MM}mm`,
      }}
    >
      <style>{ONE_PAGER_CSS}</style>
      <section className="pdf-col" style={{ fontSize: `${page.leftPoint}pt` }} data-testid="pdf-summary">
        <header>
          <p className="font-semibold">{page.name}</p>
          <p>
            {snapshot.advisor}
            {" · "}
            {formatDate(snapshot.frozen_at)}
          </p>
        </header>
        <h2 className="mt-[1.5mm] text-[11pt] font-semibold leading-tight">{page.title}</h2>
        <section className="mt-[2mm]">
          <h3 className="font-semibold">Today</h3>
          {page.today.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
        <section className="mt-[2mm]">
          <h3 className="font-semibold">Your recommended plan</h3>
          {page.plan.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
        <section className="mt-[2mm]">
          <h3 className="font-semibold">Payoff order</h3>
          {page.payoff.length === 0 ? (
            <p>{snapshot.plan.debtFree}</p>
          ) : (
            <table className="pdf-schedule">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Debt</th>
                  <th scope="col">Interest rate</th>
                  <th scope="col">Paid off</th>
                </tr>
              </thead>
              <tbody>
                {page.payoff.map((row, index) => (
                  <tr key={`${row.debt}-${row.when}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{row.debt}</td>
                    <td>{row.rate}</td>
                    <td>{row.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {page.advantages.length > 0 ? (
          <section className="mt-[2mm]">
            <h3 className="font-semibold">What&apos;s good about this plan</h3>
            <ul>
              {page.advantages.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {page.things.length > 0 ? (
          <section className="mt-[2mm]">
            <h3 className="font-semibold">Things to know</h3>
            <ul>
              {page.things.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {page.edits.length > 0 ? (
          <section className="mt-[2mm]" data-testid="data-edits">
            <h3 className="font-semibold">Data edits, if any</h3>
            <ul>
              {page.edits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="pdf-note">{page.note}</p>
      </section>
      <section className="pdf-col" style={{ fontSize: `${page.schedulePoint}pt` }} data-testid="pdf-schedule">
        <h2 className="font-semibold">Your schedule</h2>
        <p>Monthly for the first 2 years, then yearly.</p>
        <table className="pdf-schedule mt-[1.5mm]">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Payment</th>
              <th scope="col">Interest</th>
              <th scope="col">Balance</th>
              <th scope="col">Cleared</th>
            </tr>
          </thead>
          <tbody>
            {page.schedule.map((row) => (
              <tr key={`${row.kind}-${row.when}`} data-schedule-line={row.when}>
                <td>{row.when}</td>
                <td>{row.payment}</td>
                <td>{row.interest}</td>
                <td>{row.balance}</td>
                <td>{row.cleared}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </article>
  );
}
