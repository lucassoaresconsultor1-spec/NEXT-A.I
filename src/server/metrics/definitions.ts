// Sales metrics: the single definition of every number shown by goals, the
// salesperson app, dashboards, reports and AI (ADR-012). Pure functions over the
// sums computed in SQL (src/server/metrics/sales.ts); money in integer cents.
//
// grossRevenueCents  Σ subtotal + surcharge of sales completed in the period (cancelled later included)
// discountCents      Σ discount of the same sales
// cancelledCents     Σ total of sales whose cancellation happened in the period
// returnedCents      Σ refunded amount of item returns registered in the period
// netRevenueCents    gross − discount − cancelled − returned
// saleCount          sales completed in the period that are still completed (not cancelled)
// averageTicketCents floor(net ÷ saleCount); 0 without sales
// itemsPerSale       Σ quantity of the counted sales ÷ saleCount, rounded down to 2 decimals ("0.00" without sales)

export interface SalesMetrics {
  grossRevenueCents: number;
  discountCents: number;
  cancelledCents: number;
  returnedCents: number;
  netRevenueCents: number;
  saleCount: number;
  averageTicketCents: number;
  itemsPerSale: string;
}

export interface MetricSums {
  grossCents: number;
  discountCents: number;
  cancelledCents: number;
  returnedCents: number;
  saleCount: number;
  /** Σ quantity of the counted sales, in thousandths. */
  itemsMilli: bigint;
}

export const EMPTY_SUMS: MetricSums = { grossCents: 0, discountCents: 0, cancelledCents: 0, returnedCents: 0, saleCount: 0, itemsMilli: BigInt(0) };

export function buildMetrics(sums: MetricSums): SalesMetrics {
  const netRevenueCents = sums.grossCents - sums.discountCents - sums.cancelledCents - sums.returnedCents;
  const averageTicketCents = sums.saleCount === 0 ? 0 : Math.floor(netRevenueCents / sums.saleCount);
  let itemsPerSale = "0.00";
  if (sums.saleCount > 0) {
    const hundredths = (sums.itemsMilli * BigInt(100)) / (BigInt(sums.saleCount) * BigInt(1000));
    itemsPerSale = `${hundredths / BigInt(100)}.${String(hundredths % BigInt(100)).padStart(2, "0")}`;
  }
  return {
    grossRevenueCents: sums.grossCents,
    discountCents: sums.discountCents,
    cancelledCents: sums.cancelledCents,
    returnedCents: sums.returnedCents,
    netRevenueCents,
    saleCount: sums.saleCount,
    averageTicketCents,
    itemsPerSale,
  };
}

/** Metrics that can be broken down into the sales that compose them (the contributions add up to the metric). */
export const DRILL_DOWN_METRICS = ["grossRevenueCents", "discountCents", "cancelledCents", "returnedCents", "netRevenueCents", "saleCount"] as const;
export type DrillDownMetric = (typeof DRILL_DOWN_METRICS)[number];
