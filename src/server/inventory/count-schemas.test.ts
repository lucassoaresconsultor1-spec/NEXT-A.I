import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approveCountSchema, countFiltersSchema, MAX_COUNTED_PER_SUBMIT, openCountSchema, recordCountSchema } from "./count-schemas";

describe("count schemas", () => {
  it("accepts an open request with optional filters", () => {
    const storeId = randomUUID();
    expect(openCountSchema.parse({ storeId, categoryId: "", brandId: "" })).toMatchObject({ storeId, categoryId: undefined, brandId: undefined });
    expect(openCountSchema.safeParse({ storeId: "x" }).success).toBe(false);
  });

  it("parses counted quantities in thousandths, allowing zero and refusing repeats", () => {
    const itemId = randomUUID();
    expect(recordCountSchema.parse({ items: [{ itemId, countedQuantity: "0" }] }).items[0].countedQuantity).toBe(BigInt(0));
    expect(recordCountSchema.parse({ items: [{ itemId, countedQuantity: "2,5" }] }).items[0].countedQuantity).toBe(BigInt(2500));
    expect(recordCountSchema.safeParse({ items: [{ itemId, countedQuantity: "-1" }] }).success).toBe(false);
    expect(recordCountSchema.safeParse({ items: [{ itemId, countedQuantity: "1" }, { itemId, countedQuantity: "2" }] }).success).toBe(false);
    const many = Array.from({ length: MAX_COUNTED_PER_SUBMIT + 1 }, () => ({ itemId: randomUUID(), countedQuantity: "1" }));
    expect(recordCountSchema.safeParse({ items: many }).success).toBe(false);
  });

  it("requires a reason to approve and ignores invalid filters", () => {
    expect(approveCountSchema.safeParse({ reason: "x" }).success).toBe(false);
    expect(countFiltersSchema.parse({ status: "nope", storeId: "x", number: "" })).toMatchObject({ status: undefined, storeId: undefined, number: undefined, page: 1 });
  });
});
