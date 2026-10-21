import { describe, expect, it } from "vitest";
import { holidaySchema, workWeekSchema } from "./schemas";

describe("calendar schemas", () => {
  it("validates holidays and forces holidays to be closed", () => {
    expect(holidaySchema.parse({ day: "2027-01-20", name: "São Sebastião", kind: "holiday" })).toMatchObject({ storeId: null, closed: true });
    expect(holidaySchema.parse({ day: "2027-02-06", name: "Aniversário", kind: "optional" }).closed).toBe(false);
    expect(holidaySchema.safeParse({ day: "2027-02-30", name: "Inválido", kind: "holiday" }).success).toBe(false);
    expect(holidaySchema.safeParse({ day: "2027-01-20", name: "X", kind: "holiday" }).success).toBe(false);
  });

  it("accepts 1 to 7 distinct weekdays between 0 and 6", () => {
    expect(workWeekSchema.parse({ weekdays: ["6", "1", "2", "3", "4", "5"] }).weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(workWeekSchema.safeParse({ weekdays: [1, 1] }).success).toBe(false);
    expect(workWeekSchema.safeParse({ weekdays: [7] }).success).toBe(false);
    expect(workWeekSchema.safeParse({ weekdays: [] }).success).toBe(false);
  });
});
