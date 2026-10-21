// Money typed in reais (pt-BR) converted to integer cents without floating
// point, and back for form defaults. Display uses formatCurrencyCents (format.ts).

/** Same ceiling as the catalog price/cost columns (MAX_CENTS in src/server/catalog/schemas.ts). */
const MAX_CENTS = 99_999_999_999;

// "1.234,56" / "1234,56" (comma decimal; dots only as thousands in groups of 3).
const COMMA_DECIMAL = /^(\d+|\d{1,3}(?:\.\d{3})+),(\d{1,2})$/;
// "1234" / "1.234" (whole reais; dots only as thousands in groups of 3).
const WHOLE = /^(\d+|\d{1,3}(?:\.\d{3})+)$/;
// "12.9" / "12.90" (a single dot followed by 1-2 digits is the decimal separator).
const DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;

function toCents(whole: string, fraction: string): number | null {
  const digits = whole.replace(/\./g, "");
  if (digits.length > 12) return null;
  const cents = Number(digits) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > MAX_CENTS ? null : cents;
}

/** "12,90" | "12.90" | "1.234,56" | "R$ 1.234,56" | "0" -> integer cents; null when invalid, negative, over 2 decimals or above the maximum. */
export function parseBrlToCents(value: string): number | null {
  const text = value.trim().replace(/^R\$\s*/, "");
  const comma = COMMA_DECIMAL.exec(text);
  if (comma) return toCents(comma[1], comma[2]);
  const dot = DOT_DECIMAL.exec(text);
  if (dot) return toCents(dot[1], dot[2]);
  const whole = WHOLE.exec(text);
  if (whole) return toCents(whole[1], "");
  return null;
}

/** 1290 -> "12,90"; 123456 -> "1.234,56"; 0 -> "0,00" (no "R$", for input defaults). */
export function formatCentsInput(cents: number): string {
  const whole = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${String(cents % 100).padStart(2, "0")}`;
}
