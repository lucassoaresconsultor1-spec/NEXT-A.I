// Exact stock quantities. The database stores numeric(14,3); the service does
// arithmetic in thousandths (bigint), so no floating-point error reaches the ledger.

// BigInt() calls instead of literals: tsconfig targets ES2017.
export const ZERO = BigInt(0);
export const QUANTITY_SCALE = BigInt(1000);
/** numeric(14,3): up to 11 integer digits. */
export const MAX_QUANTITY_MILLI = BigInt("99999999999999");

export type MovementType = "entry" | "exit" | "adjustment" | "loss" | "count";

const INPUT_PATTERN = /^(-?)(\d{1,11})(?:[.,](\d{1,3}))?$/;
const DB_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function toMilli(sign: string, whole: string, fraction = "") {
  const milli = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(3, "0").slice(0, 3) || "0");
  return sign === "-" ? -milli : milli;
}

/** Form input ("12", "0,5", "-3.250"); comma or dot as decimal separator, no thousands separator. */
export function parseQuantityInput(value: string): bigint | null {
  const match = INPUT_PATTERN.exec(value.trim());
  if (!match) return null;
  return toMilli(match[1], match[2], match[3]);
}

/** Value returned by PostgreSQL for numeric columns ("12.500", "-3.000"). */
export function fromDbQuantity(value: string): bigint {
  const match = DB_PATTERN.exec(value);
  if (!match || (match[3] && match[3].length > 3)) throw new Error("Unexpected quantity value");
  return toMilli(match[1], match[2], match[3]);
}

/** Canonical numeric text with three decimals ("12.500"), as sent to and read from the database. */
export function toDbQuantity(milli: bigint): string {
  const negative = milli < ZERO;
  const absolute = negative ? -milli : milli;
  const fraction = String(absolute % QUANTITY_SCALE).padStart(3, "0");
  return `${negative ? "-" : ""}${absolute / QUANTITY_SCALE}.${fraction}`;
}

export const isWholeQuantity = (milli: bigint) => milli % QUANTITY_SCALE === ZERO;

export interface LedgerEffect {
  /** Signed change applied to the balance. */
  delta: bigint;
  balanceAfter: bigint;
  /** Physical count result (type "count" only). */
  counted: bigint | null;
}

/**
 * Effect of a movement on the current balance. `informed` is the quantity typed
 * by the user: positive for entry/exit/loss, signed for adjustment, the counted
 * total for count. Input rules are enforced by the schema; this only does the math.
 */
export function ledgerEffect(type: MovementType, informed: bigint, current: bigint): LedgerEffect {
  if (type === "count") return { delta: informed - current, balanceAfter: informed, counted: informed };
  const delta = type === "exit" || type === "loss" ? -informed : informed;
  return { delta, balanceAfter: current + delta, counted: null };
}
