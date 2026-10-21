import { describe, expect, it } from "vitest";
import { buildMetrics, EMPTY_SUMS } from "./definitions";

describe("sales metric definitions", () => {
  it("derives net revenue, average ticket (rounded down) and items per sale", () => {
    expect(buildMetrics({ grossCents: 10_050, discountCents: 50, cancelledCents: 1000, returnedCents: 500, saleCount: 3, itemsMilli: BigInt(7500) })).toEqual({
      grossRevenueCents: 10_050,
      discountCents: 50,
      cancelledCents: 1000,
      returnedCents: 500,
      netRevenueCents: 8500,
      saleCount: 3,
      averageTicketCents: 2833,
      itemsPerSale: "2.50",
    });
    expect(buildMetrics({ ...EMPTY_SUMS, grossCents: 1000, saleCount: 3, itemsMilli: BigInt(1000) })).toMatchObject({ averageTicketCents: 333, itemsPerSale: "0.33" });
  });

  it("answers zero without sales, even with returns of earlier sales", () => {
    expect(buildMetrics(EMPTY_SUMS)).toMatchObject({ netRevenueCents: 0, averageTicketCents: 0, itemsPerSale: "0.00" });
    expect(buildMetrics({ ...EMPTY_SUMS, returnedCents: 700 })).toMatchObject({ netRevenueCents: -700, averageTicketCents: 0 });
  });
});
