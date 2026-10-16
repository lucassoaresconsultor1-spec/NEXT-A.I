import { DEFAULT_TIMEZONE, LOCALE } from "./brazil";

// pt-BR presentation helpers. Values are formatted, never recalculated here.

const integerFormat = new Intl.NumberFormat(LOCALE);

export function formatInteger(value: number) {
  return integerFormat.format(value);
}

/** Money arrives as integer cents to avoid binary floating-point errors. */
export function formatCurrencyCents(cents: number) {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatPercent(ratio: number, fractionDigits = 1) {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}

export function formatDate(value: Date, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeZone }).format(value);
}

export function formatDateTime(value: Date, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short", timeZone }).format(value);
}
