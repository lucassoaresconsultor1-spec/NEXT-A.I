import { describe, expect, it } from "vitest";
import { commissionOf, rateFor, ruleInForce, type RuleVersion } from "./schemas";

const rule = (values: Partial<RuleVersion> & Pick<RuleVersion, "id" | "effectiveFrom">): RuleVersion => ({ storeId: null, version: 1, defaultRateBps: 300, rates: new Map(), ...values });

describe("commission rules", () => {
  const rules = [
    rule({ id: "org-1", effectiveFrom: "2027-01-01", defaultRateBps: 200 }),
    rule({ id: "org-2", effectiveFrom: "2027-03-01", version: 2, defaultRateBps: 250 }),
    rule({ id: "store-1", storeId: "A", effectiveFrom: "2027-02-01", defaultRateBps: 400, rates: new Map([["cat", 800]]) }),
    rule({ id: "store-2", storeId: "A", effectiveFrom: "2027-02-01", version: 2, defaultRateBps: 500 }),
  ];

  it("picks the store rule in force, else the organization's, by start date and version", () => {
    expect(ruleInForce(rules, "A", "2027-01-15")?.id).toBe("org-1");
    expect(ruleInForce(rules, "A", "2027-02-10")?.id).toBe("store-2");
    expect(ruleInForce(rules, "B", "2027-03-10")?.id).toBe("org-2");
    expect(ruleInForce(rules, "B", "2026-12-31")).toBeNull();
    expect(rateFor(rules[2], "cat")).toEqual({ ruleId: "store-1", rateBps: 800 });
    expect(rateFor(rules[2], "other")).toEqual({ ruleId: "store-1", rateBps: 400 });
    expect(rateFor(null, "cat")).toEqual({ ruleId: null, rateBps: 0 });
  });

  it("rounds down and reverses exactly", () => {
    expect(commissionOf(1999, 250)).toBe(49);
    expect(commissionOf(-1999, 250)).toBe(-49);
    expect(commissionOf(0, 500)).toBe(0);
  });
});
