import { describe, expect, it } from "vitest";
import { zonedDayStart } from "./dates";
import { formatCurrencyCents, formatDate, formatDateTime, formatInteger, formatPercent } from "./format";

// Intl uses a non-breaking space between "R$" and the amount.
const normalizeSpaces = (value: string) => value.replace(/ | /g, " ");

describe("pt-BR formatting", () => {
  it("formats integers, money in cents and percentages", () => {
    expect(formatInteger(1234567)).toBe("1.234.567");
    expect(normalizeSpaces(formatCurrencyCents(123456))).toBe("R$ 1.234,56");
    expect(normalizeSpaces(formatCurrencyCents(-5))).toBe("-R$ 0,05");
    expect(formatPercent(0.1234)).toBe("12,3%");
  });

  it("renders dates in the organization time zone", () => {
    const instant = new Date("2026-10-16T02:30:00Z");
    expect(formatDate(instant, "America/Sao_Paulo")).toBe("15/10/2026");
    expect(formatDate(instant, "America/Noronha")).toBe("16/10/2026");
    expect(formatDateTime(instant, "America/Manaus")).toBe("15/10/2026, 22:30");
  });
});

describe("zonedDayStart", () => {
  it("returns local midnight as a UTC instant", () => {
    expect(zonedDayStart("2026-10-16", "America/Sao_Paulo").toISOString()).toBe("2026-10-16T03:00:00.000Z");
    expect(zonedDayStart("2026-10-16", "America/Manaus").toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(zonedDayStart("2026-10-16", "America/Noronha").toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("supports exclusive upper bounds by adding days across month ends", () => {
    expect(zonedDayStart("2026-10-31", "America/Sao_Paulo", 1).toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});
