import { ONE_PAGER_CSS, onePagerContent, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/one-pager";
import { formatDate } from "@/lib/format";
import type { FrozenSnapshot } from "@/lib/snapshot";

/** The household one-pager. The same sheet is the on-screen preview and the print. */
export function OnePager({ snapshot }: { snapshot: FrozenSnapshot }) {
  const page = onePagerContent(snapshot);

  return (
    <article
      className="pdf-sheet bg-white text-neutral-900 shadow-sm print:shadow-none"
      data-testid="one-pager"
      data-point-size={page.point}
      data-payoff-rows={page.payoff.length}
      style={{
        width: `${SHEET_WIDTH_MM}mm`,
        height: `${SHEET_HEIGHT_MM}mm`,
        fontSize: `${page.point}pt`,
      }}
    >
      <style>{ONE_PAGER_CSS}</style>
      <header data-testid="pdf-summary">
        <p className="font-semibold">{page.name}</p>
        <p>
          {snapshot.advisor}
          {" · "}
          {formatDate(snapshot.frozen_at)}
        </p>
      </header>
      <h2 className="mt-[1.5mm] text-[11pt] font-semibold leading-[1.2]">{page.title}</h2>
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
          <table className="pdf-table">
            <colgroup>
              <col style={{ width: "8mm" }} />
              <col />
              <col style={{ width: "28mm" }} />
              <col style={{ width: "62mm" }} />
            </colgroup>
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
    </article>
  );
}
