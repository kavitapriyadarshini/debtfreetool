import type { PayoffRow } from "@/lib/present";
import { cn } from "@/lib/utils";

/** Payoff order: number, debt, interest rate, and the month it is paid off. */
export function PayoffTable({ rows, className }: { rows: readonly PayoffRow[]; className?: string }) {
  return (
    <table className={cn("w-full border-collapse text-left", className)}>
      <thead>
        <tr>
          <th scope="col" className="py-1 pr-3 font-medium">#</th>
          <th scope="col" className="py-1 pr-3 font-medium">Debt</th>
          <th scope="col" className="py-1 pr-3 font-medium">Interest rate</th>
          <th scope="col" className="py-1 font-medium">Paid off</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.debt}-${row.when}-${index}`} className="align-top">
            <td className="py-1 pr-3">{index + 1}</td>
            <td className="py-1 pr-3">{row.debt}</td>
            <td className="py-1 pr-3">{row.rate}</td>
            <td className="py-1">{row.when}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
