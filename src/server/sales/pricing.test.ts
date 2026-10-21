import { describe, expect, it } from "vitest";
import { cashChange, discountBps, lineTotals, saleTotals } from "./pricing";

const milli = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
};

describe("lineTotals", () => {
  it("multiplies unit price by quantity in thousandths", () => {
    expect(lineTotals({ quantityMilli: milli("3"), unitPriceCents: 1290, discountCents: 0 })).toEqual({ grossCents: 3870, netCents: 3870 });
  });

  it("rounds half up on fractional quantities", () => {
    // 0,355 kg × R$ 49,90 = 1771,45 centavos -> 1771; 0,355 kg × R$ 49,94 = 1772,87 -> 1773
    expect(lineTotals({ quantityMilli: milli("0.355"), unitPriceCents: 4990, discountCents: 0 }).grossCents).toBe(1771);
    expect(lineTotals({ quantityMilli: milli("0.355"), unitPriceCents: 4994, discountCents: 0 }).grossCents).toBe(1773);
    expect(lineTotals({ quantityMilli: milli("0.5"), unitPriceCents: 1, discountCents: 0 }).grossCents).toBe(1);
  });

  it("subtracts the line discount", () => {
    expect(lineTotals({ quantityMilli: milli("2"), unitPriceCents: 1000, discountCents: 300 })).toEqual({ grossCents: 2000, netCents: 1700 });
  });
});

describe("saleTotals and discountBps", () => {
  it("adds gross values, discounts and surcharge", () => {
    const totals = saleTotals(
      [
        { quantityMilli: milli("1"), unitPriceCents: 6000, discountCents: 1 },
        { quantityMilli: milli("1"), unitPriceCents: 4000, discountCents: 0 },
      ],
      1000,
      250,
    );
    expect(totals).toEqual({ subtotalCents: 10000, discountCents: 1001, surchargeCents: 250, totalCents: 9249 });
  });

  it("rounds the discount percentage up", () => {
    expect(discountBps(1001, 10000)).toBe(1001);
    expect(discountBps(1000, 10000)).toBe(1000);
    expect(discountBps(1, 30000)).toBe(1);
    expect(discountBps(0, 10000)).toBe(0);
    expect(discountBps(1, 0)).toBe(10000);
  });
});

describe("cashChange", () => {
  it("returns the change", () => {
    expect(cashChange(3870, 5000)).toBe(1130);
    expect(cashChange(3870, 3870)).toBe(0);
  });
});
