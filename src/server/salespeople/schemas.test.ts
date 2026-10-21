import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { salespersonSchema, scheduleSchema } from "./schemas";

describe("salespeople schemas", () => {
  it("normalizes the code and requires stores", () => {
    const base = { membershipId: randomUUID(), nickname: "Ana", storeIds: [randomUUID()] };
    expect(salespersonSchema.parse({ ...base, code: " v01 " }).code).toBe("V01");
    expect(salespersonSchema.safeParse({ ...base, code: "V-01" }).success).toBe(false);
    expect(salespersonSchema.safeParse({ ...base, code: "V1", storeIds: [] }).success).toBe(false);
  });

  it("accepts only days off of the chosen month, without repeats", () => {
    const base = { salespersonId: randomUUID(), storeId: randomUUID(), month: "2027-01" };
    expect(scheduleSchema.parse({ ...base, daysOff: ["2027-01-15", "2027-01-08"] }).daysOff).toEqual(["2027-01-08", "2027-01-15"]);
    expect(scheduleSchema.safeParse({ ...base, daysOff: ["2027-02-01"] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, daysOff: ["2027-01-08", "2027-01-08"] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, month: "2027-13", daysOff: [] }).success).toBe(false);
  });
});
