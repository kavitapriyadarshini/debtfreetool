import { ONE_PAGER_CSS, onePagerContent, payoffLine, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/one-pager";
import type { FrozenSnapshot } from "@/lib/snapshot";

/** The household one-pager. The same card is the on-screen preview and the print. */
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
      <header className="pdf-head" data-testid="pdf-summary">
        <div>
          <p className="pdf-name">{page.name}</p>
          <h2 className="pdf-title">{page.title}</h2>
        </div>
        <p className="pdf-meta">
          {page.advisor}
          <br />
          {page.date}
        </p>
      </header>
      <div className="pdf-compare">
        <section>
          <h3 className="pdf-label">Today</h3>
          {page.today.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
        <section>
          <h3 className="pdf-label">Your recommended plan</h3>
          {page.plan.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      </div>
      <section>
        <h3 className="pdf-label">Order your debts are paid off</h3>
        {page.payoff.length === 0 ? (
          <p>{snapshot.plan.debtFree}</p>
        ) : (
          <ol className="pdf-payoff" data-testid="pdf-payoff">
            {page.payoff.map((row, index) => (
              <li key={`${row.debt}-${row.when}-${index}`}>{payoffLine(row)}</li>
            ))}
          </ol>
        )}
      </section>
      {page.loan ? <p>{page.loan}</p> : null}
      {page.advantages.length > 0 ? (
        <section>
          <h3 className="pdf-label">What&apos;s good about this plan</h3>
          <ul>
            {page.advantages.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {page.things.length > 0 ? (
        <section>
          <h3 className="pdf-label">Things to know</h3>
          <ul>
            {page.things.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {page.edits.length > 0 ? (
        <section data-testid="data-edits">
          <h3 className="pdf-label">Data edits, if any</h3>
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
