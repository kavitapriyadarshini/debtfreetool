/**
 * Python 3 `round`: half to even, including the same binary-float halfway cases.
 * Interest in the fixtures may still differ by $1; payment fields need this to match.
 */
export function pythonRound(value: number, ndigits = 0): number {
  if (!Number.isFinite(value)) return value;
  const negative = value < 0;
  const factor = 10 ** ndigits;
  const scaled = Math.abs(value) * factor;
  let rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) === 0.5) rounded = 2 * Math.round(scaled / 2);
  if (ndigits === 0) return negative ? -rounded : rounded;
  const digits = rounded.toString().padStart(ndigits + 1, "0");
  const whole = digits.slice(0, digits.length - ndigits);
  const fraction = digits.slice(digits.length - ndigits);
  return Number(`${negative ? "-" : ""}${whole}.${fraction}`);
}
