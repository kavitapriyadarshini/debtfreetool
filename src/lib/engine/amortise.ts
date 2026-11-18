/** Fully amortising monthly payment. `rate` is APR percent. Zero interest is principal / term. */
export function amortise(principal: number, rate: number, termMonths: number): number {
  const monthlyRate = rate / 1200;
  if (monthlyRate === 0) return principal / termMonths;
  return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -termMonths);
}
