import { describe, expect, it } from "vitest";
import {
  CalendarOptions,
  countBusinessDays,
  easterSunday,
  isBusinessDay,
  isValidCalendarDay,
  listBusinessDays,
  MAX_EXTRA_HOLIDAYS,
  MAX_SPAN_DAYS,
  MAX_YEAR,
  MIN_YEAR,
  NATIONAL_FIXED_HOLIDAYS,
} from "./business-days";

describe("business-days", () => {
  describe("constants and exports", () => {
    it("exports valid range constants and ordered holidays", () => {
      expect(MIN_YEAR).toBe(1900);
      expect(MAX_YEAR).toBe(2199);
      expect(MAX_SPAN_DAYS).toBe(3660);
      expect(MAX_EXTRA_HOLIDAYS).toBe(1000);
      expect(NATIONAL_FIXED_HOLIDAYS).toHaveLength(9);
      expect(NATIONAL_FIXED_HOLIDAYS[7]).toEqual({
        monthDay: "11-20",
        name: "Dia da Consciência Negra",
        fromYear: 2024,
      });
    });
  });

  describe("isValidCalendarDay", () => {
    it.each([
      ["2026-10-20", true],
      ["2024-02-29", true],
      ["2000-02-29", true],
      ["2026-02-29", false],
      ["2100-02-29", false],
      ["2026-02-30", false],
      ["2026-13-01", false],
      ["2026-2-3", false],
      ["", false],
      ["1899-12-31", false],
      ["2200-01-01", false],
      [undefined, false],
      [null, false],
      [20261020, false],
      [{}, false],
      [[], false],
    ])("validates %s to %s without throwing", (input, expected) => {
      expect(isValidCalendarDay(input)).toBe(expected);
    });
  });

  describe("easterSunday", () => {
    it.each([
      [2000, "2000-04-23"],
      [2024, "2024-03-31"],
      [2025, "2025-04-20"],
      [2026, "2026-04-05"],
      [2027, "2027-03-28"],
      [2038, "2038-04-25"],
    ])("computes Easter for %i as %s", (year, expected) => {
      expect(easterSunday(year)).toBe(expected);
    });

    it.each([1899, 2200, 2026.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "throws RangeError for invalid year %s",
      (invalidYear) => {
        expect(() => easterSunday(invalidYear)).toThrow(RangeError);
      },
    );
  });

  describe("isBusinessDay", () => {
    it("evaluates default calendar days and fixed national holidays", () => {
      expect(isBusinessDay("2026-10-20")).toBe(true);
      expect(isBusinessDay("2026-01-03")).toBe(false);
      expect(isBusinessDay("2026-01-04")).toBe(false);
      expect(isBusinessDay("2026-10-12")).toBe(false);
      expect(isBusinessDay("2026-01-01")).toBe(false);
    });

    it("respects holiday effective year for Dia da Consciência Negra", () => {
      expect(isBusinessDay("2023-11-20")).toBe(true);
      expect(isBusinessDay("2024-11-20")).toBe(false);
    });

    it("handles extraHolidays and duplicates", () => {
      expect(isBusinessDay("2026-02-17", { extraHolidays: ["2026-02-17", "2026-02-17"] })).toBe(false);
      expect(isBusinessDay("2026-01-03", { extraHolidays: ["2026-01-03"] })).toBe(false);
    });

    it("allows disabling fixed national holidays", () => {
      expect(isBusinessDay("2026-10-12", { includeNationalHolidays: false })).toBe(true);
    });

    it("supports custom working weekdays", () => {
      expect(isBusinessDay("2026-01-03", { workingWeekdays: [1, 2, 3, 4, 5, 6] })).toBe(true);
      expect(isBusinessDay("2026-01-04", { workingWeekdays: [1, 2, 3, 4, 5, 6] })).toBe(false);
    });
  });

  describe("countBusinessDays and listBusinessDays", () => {
    it.each([
      ["2026-01-01", "2026-01-31", 21],
      ["2026-02-01", "2026-02-28", 20],
      ["2026-04-01", "2026-04-30", 21],
      ["2026-11-01", "2026-11-30", 19],
      ["2026-12-01", "2026-12-31", 22],
      ["2023-11-01", "2023-11-30", 20],
    ])("counts standard month days %s to %s as %i", (from, to, expected) => {
      expect(countBusinessDays(from, to)).toBe(expected);
    });

    it("computes counts with options", () => {
      expect(
        countBusinessDays("2026-02-01", "2026-02-28", {
          extraHolidays: ["2026-02-16", "2026-02-17"],
        }),
      ).toBe(18);
      expect(
        countBusinessDays("2026-04-01", "2026-04-30", {
          extraHolidays: ["2026-04-03"],
        }),
      ).toBe(20);
      expect(
        countBusinessDays("2026-02-01", "2026-02-28", {
          workingWeekdays: [1, 2, 3, 4, 5, 6],
        }),
      ).toBe(24);
    });

    it("evaluates single-day periods (from === to)", () => {
      expect(countBusinessDays("2026-10-20", "2026-10-20")).toBe(1);
      expect(countBusinessDays("2026-10-17", "2026-10-17")).toBe(0);
    });

    it("lists business days in ascending order with and without extras", () => {
      const baseDays = [
        "2026-04-01",
        "2026-04-02",
        "2026-04-03",
        "2026-04-06",
        "2026-04-07",
        "2026-04-08",
        "2026-04-09",
        "2026-04-10",
      ];
      expect(listBusinessDays("2026-04-01", "2026-04-10")).toEqual(baseDays);

      const withExtra = listBusinessDays("2026-04-01", "2026-04-10", {
        extraHolidays: ["2026-04-03"],
      });
      expect(withExtra).toEqual(baseDays.filter((day) => day !== "2026-04-03"));
      expect(withExtra).toHaveLength(7);
    });

    it("maintains length consistency between listBusinessDays and countBusinessDays", () => {
      const cases: Array<[string, string, CalendarOptions?]> = [
        ["2026-01-01", "2026-03-31", undefined],
        ["2026-04-01", "2026-04-30", { extraHolidays: ["2026-04-03"] }],
        ["2026-05-01", "2026-05-31", { workingWeekdays: [1, 2, 3, 4, 5, 6] }],
      ];
      for (const [from, to, opts] of cases) {
        expect(listBusinessDays(from, to, opts)).toHaveLength(countBusinessDays(from, to, opts));
      }
    });

    it("enforces MAX_SPAN_DAYS boundary", () => {
      expect(() => countBusinessDays("2020-01-01", "2030-01-07")).not.toThrow();
      expect(() => countBusinessDays("2020-01-01", "2030-01-08")).toThrow(RangeError);
      expect(() => listBusinessDays("2020-01-01", "2030-01-08")).toThrow(RangeError);
      expect(() => countBusinessDays("2020-01-01", "2030-12-31")).toThrow(RangeError);
    });

    it("leaves count and list unchanged when extra holidays fall on weekends", () => {
      const weekendExtras = { extraHolidays: ["2026-02-07", "2026-02-08"] };
      expect(countBusinessDays("2026-02-01", "2026-02-28", weekendExtras)).toBe(20);
      expect(countBusinessDays("2026-02-01", "2026-02-28")).toBe(20);
      expect(listBusinessDays("2026-02-01", "2026-02-28", weekendExtras)).toEqual(
        listBusinessDays("2026-02-01", "2026-02-28"),
      );
    });

    it("accepts duplicated working weekdays without error", () => {
      expect(
        countBusinessDays("2026-02-01", "2026-02-28", {
          workingWeekdays: [1, 1, 2, 3, 4, 5, 5],
        }),
      ).toBe(20);
      expect(isBusinessDay("2026-10-20", { workingWeekdays: [2, 2] })).toBe(true);
    });

    it("handles MAX_SPAN_DAYS boundary in listBusinessDays matching count", () => {
      const listAtLimit = listBusinessDays("2020-01-01", "2030-01-07");
      expect(listAtLimit.length).toBeGreaterThan(0);
      expect(listAtLimit).toHaveLength(countBusinessDays("2020-01-01", "2030-01-07"));
    });
  });

  describe("error handling and hostile options", () => {
    it.each([
      ["from after to", "2026-01-02", "2026-01-01"],
      ["undefined from", undefined as unknown as string, "2026-01-01"],
      ["undefined to", "2026-01-01", undefined as unknown as string],
      ["number as from", 20260101 as unknown as string, "2026-01-02"],
      ["invalid string day", "2026-02-30", "2026-03-01"],
    ])("rejects invalid range (%s) with RangeError", (_, from, to) => {
      expect(() => countBusinessDays(from, to)).toThrow(RangeError);
      expect(() => listBusinessDays(from, to)).toThrow(RangeError);
    });

    it("rejects non-calendar day in isBusinessDay with RangeError", () => {
      expect(() => isBusinessDay("2026-02-30")).toThrow(RangeError);
      expect(() => isBusinessDay(undefined as unknown as string)).toThrow(RangeError);
      expect(() => isBusinessDay(20260101 as unknown as string)).toThrow(RangeError);
    });

    const hostileOptionsList: Array<[string, unknown]> = [
      ["null options", null],
      ["array options", []],
      ["string options", "options"],
      ["non-array extraHolidays string", { extraHolidays: "2026-02-17" }],
      ["non-array extraHolidays object", { extraHolidays: {} }],
      ["invalid extra holiday", { extraHolidays: ["2026-02-30"] }],
      ["proto extra holiday", { extraHolidays: ["__proto__"] }],
      ["sparse array in extraHolidays", { extraHolidays: ["2026-02-16", , "2026-02-17"] }],
      ["empty workingWeekdays", { workingWeekdays: [] }],
      ["weekday 7", { workingWeekdays: [7] }],
      ["negative weekday", { workingWeekdays: [-1] }],
      ["float weekday", { workingWeekdays: [1.5] }],
      ["NaN weekday", { workingWeekdays: [Number.NaN] }],
      ["Infinity weekday", { workingWeekdays: [Number.POSITIVE_INFINITY] }],
      ["string workingWeekdays", { workingWeekdays: "12345" }],
      ["sparse array in workingWeekdays", { workingWeekdays: [1, , 3] }],
      ["string includeNationalHolidays", { includeNationalHolidays: "false" }],
      ["number includeNationalHolidays", { includeNationalHolidays: 0 }],
    ];

    it.each(hostileOptionsList)(
      "throws RangeError on hostile option: %s",
      (_, invalidOption) => {
        const opts = invalidOption as unknown as CalendarOptions;
        expect(() => isBusinessDay("2026-10-20", opts)).toThrow(RangeError);
        expect(() => countBusinessDays("2026-10-01", "2026-10-20", opts)).toThrow(RangeError);
        expect(() => listBusinessDays("2026-10-01", "2026-10-20", opts)).toThrow(RangeError);
      },
    );

    it("handles MAX_EXTRA_HOLIDAYS boundary", () => {
      const maxHolidays = Array.from({ length: MAX_EXTRA_HOLIDAYS }, () => "2026-10-20");
      expect(() => isBusinessDay("2026-10-20", { extraHolidays: maxHolidays })).not.toThrow();

      const tooManyHolidays = Array.from({ length: MAX_EXTRA_HOLIDAYS + 1 }, () => "2026-10-20");
      expect(() => isBusinessDay("2026-10-20", { extraHolidays: tooManyHolidays })).toThrow(RangeError);
    });

    it("ignores unknown fields in options", () => {
      const opts = { unknownField: "ignored", includeNationalHolidays: true } as unknown as CalendarOptions;
      expect(isBusinessDay("2026-10-20", opts)).toBe(true);
    });

    it("preserves immutability of inputs and returns fresh arrays", () => {
      const extraHolidays = ["2026-04-03"];
      const workingWeekdays = [1, 2, 3, 4, 5];
      const frozenExtra = [...extraHolidays];
      const frozenWeekdays = [...workingWeekdays];

      const res1 = listBusinessDays("2026-04-01", "2026-04-05", {
        extraHolidays,
        workingWeekdays,
      });
      const res2 = listBusinessDays("2026-04-01", "2026-04-05", {
        extraHolidays,
        workingWeekdays,
      });

      expect(extraHolidays).toEqual(frozenExtra);
      expect(workingWeekdays).toEqual(frozenWeekdays);
      expect(res1).not.toBe(res2);
      expect(res1).toEqual(res2);
    });
  });
});
