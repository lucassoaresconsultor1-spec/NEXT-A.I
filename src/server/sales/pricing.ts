// Pure money arithmetic for POS sales: integer cents, quantities in thousandths
// (bigint), no floating point anywhere.

const SCALE = BigInt(1000);
const HALF = BigInt(500);

export interface PricedLine {
  quantityMilli: bigint;
  unitPriceCents: number;
  discountCents: number;
}

/** Line gross = round_half_up(unit price × quantity); line net = gross − discount. */
export function lineTotals(line: PricedLine): { grossCents: number; netCents: number } {
  const grossCents = Number((BigInt(line.unitPriceCents) * line.quantityMilli + HALF) / SCALE);
  return { grossCents, netCents: grossCents - line.discountCents };
}

/** subtotal = Σ gross; discount = Σ line discounts + sale discount; total = subtotal − discount + surcharge. */
export function saleTotals(lines: PricedLine[], saleDiscountCents: number, surchargeCents: number) {
  let subtotalCents = 0;
  let lineDiscounts = 0;
  for (const line of lines) {
    subtotalCents += lineTotals(line).grossCents;
    lineDiscounts += line.discountCents;
  }
  const discountCents = lineDiscounts + saleDiscountCents;
  return { subtotalCents, discountCents, surchargeCents, totalCents: subtotalCents - discountCents + surchargeCents };
}

/** Discount in basis points of the subtotal, rounded up, so 10,01 % never passes a 10 % ceiling. */
export function discountBps(discountCents: number, subtotalCents: number): number {
  if (discountCents <= 0) return 0;
  if (subtotalCents <= 0) return 10_000;
  const scaled = BigInt(discountCents) * BigInt(10_000);
  const denominator = BigInt(subtotalCents);
  return Number((scaled + denominator - BigInt(1)) / denominator);
}

/** Change of a cash payment (tendered must cover the amount). */
export function cashChange(amountCents: number, tenderedCents: number): number {
  return tenderedCents - amountCents;
}
