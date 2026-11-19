import type { PayoffRow } from "@/lib/present";
import { cn } from "@/lib/utils";

/** Payoff order: number, debt, interest rate, and the month it is paid off. */
export function PayoffTable({ rows, className }: { rows: readonly PayoffRow[]; className?: string }) {
  return (
    <table className={cn("w-full border-collapse text-left", className)}>
      <thead>
        <tr>
          <th scope="col" className="py-1 pr-3 font-medium whitespace-nowrap">#</th>
          <th scope="col" className="py-1 pr-3 font-medium whitespace-nowrap">Debt</th>
          <th scope="col" className="py-1 pr-3 font-medium whitespace-nowrap">Interest rate</th>
          <th scope="col" className="py-1 font-medium whitespace-nowrap">Paid off</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.debt}-${row.when}-${index}`} className="align-top">
            <td className="py-1 pr-3 whitespace-nowrap">{index + 1}</td>
            <td className="py-1 pr-3 whitespace-nowrap">{row.debt}</td>
            <td className="py-1 pr-3 whitespace-nowrap">{row.rate}</td>
            <td className="py-1 whitespace-nowrap">{row.when}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
