/**
 * Pure and deterministic calendar business day utilities.
 * Validates days, computes Gregorian Easter, and calculates business day spans.
 */

/** A day on the calendar, "YYYY-MM-DD" (no time of day, no time zone). */
export type CalendarDay = string;

/** Years accepted by every function (inclusive). */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2199;

/** Largest period (both ends counted) accepted by countBusinessDays/listBusinessDays. */
export const MAX_SPAN_DAYS = 3660;

/** Largest extraHolidays array accepted (before removing duplicates). */
export const MAX_EXTRA_HOLIDAYS = 1000;

export interface NationalHoliday {
  /** "MM-DD". */
  readonly monthDay: string;
  /** Display name, pt-BR. */
  readonly name: string;
  /** First year in which the day is a national holiday; absent = always. */
  readonly fromYear?: number;
}

/** Fixed-date national holidays. Order: calendar order. */
export const NATIONAL_FIXED_HOLIDAYS: readonly NationalHoliday[] = [
  { monthDay: "01-01", name: "Confraternização Universal" },
  { monthDay: "04-21", name: "Tiradentes" },
  { monthDay: "05-01", name: "Dia do Trabalho" },
  { monthDay: "09-07", name: "Independência do Brasil" },
  { monthDay: "10-12", name: "Nossa Senhora Aparecida" },
  { monthDay: "11-02", name: "Finados" },
  { monthDay: "11-15", name: "Proclamação da República" },
  { monthDay: "11-20", name: "Dia da Consciência Negra", fromYear: 2024 },
  { monthDay: "12-25", name: "Natal" },
];

export interface CalendarOptions {
  /**
   * Additional non-working days (state, municipal, optional). Must be an array of valid CalendarDay with at
   * most MAX_EXTRA_HOLIDAYS entries; duplicates allowed; weekends have no extra effect. Internally held in a Set.
   */
  readonly extraHolidays?: readonly CalendarDay[];
  /** Working weekdays, 0 = Sunday … 6 = Saturday. Default [1, 2, 3, 4, 5]. Must be a non-empty array of integers 0..6. */
  readonly workingWeekdays?: readonly number[];
  /** Whether NATIONAL_FIXED_HOLIDAYS apply. Default true. Must be a boolean when given. */
  readonly includeNationalHolidays?: boolean;
}

interface ValidatedOptions {
  readonly extraHolidaysSet: Set<string>;
  readonly workingWeekdaysSet: Set<number>;
  readonly includeNationalHolidays: boolean;
}

const DEFAULT_WORKING_WEEKDAYS = new Set([1, 2, 3, 4, 5]);
const MILLIS_PER_DAY = 86_400_000;
const CALENDAR_DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is a string holding a real calendar day "YYYY-MM-DD" with MIN_YEAR <= year <= MAX_YEAR.
 * Accepts any input and never throws: undefined, numbers, objects and other non-strings return false.
 */
export function isValidCalendarDay(value: unknown): value is CalendarDay {
  if (typeof value !== "string" || !CALENDAR_DAY_REGEX.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Gregorian Easter Sunday of `year` (integer in MIN_YEAR..MAX_YEAR). Throws RangeError otherwise (including NaN and Infinity).
 * Computed using the Meeus/Jones/Butcher algorithm.
 */
export function easterSunday(year: number): CalendarDay {
  if (typeof year !== "number" || !Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}`);
  }

  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCalendarOptions(options?: CalendarOptions): ValidatedOptions {
  if (options === undefined) {
    return {
      extraHolidaysSet: new Set<string>(),
      workingWeekdaysSet: DEFAULT_WORKING_WEEKDAYS,
      includeNationalHolidays: true,
    };
  }

  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new RangeError("Options must be a plain object");
  }

  let extraHolidaysSet = new Set<string>();
  if (options.extraHolidays !== undefined) {
    if (!Array.isArray(options.extraHolidays)) {
      throw new RangeError("extraHolidays must be an array");
    }
    if (options.extraHolidays.length > MAX_EXTRA_HOLIDAYS) {
      throw new RangeError(`extraHolidays exceeds maximum of ${MAX_EXTRA_HOLIDAYS}`);
    }
    extraHolidaysSet = new Set<string>();
    for (let i = 0; i < options.extraHolidays.length; i++) {
      const holiday = options.extraHolidays[i];
      if (!isValidCalendarDay(holiday)) {
        throw new RangeError(`Invalid calendar day in extraHolidays: ${String(holiday)}`);
      }
      extraHolidaysSet.add(holiday);
    }
  }

  let workingWeekdaysSet = DEFAULT_WORKING_WEEKDAYS;
  if (options.workingWeekdays !== undefined) {
    if (!Array.isArray(options.workingWeekdays) || options.workingWeekdays.length === 0) {
      throw new RangeError("workingWeekdays must be a non-empty array");
    }
    workingWeekdaysSet = new Set<number>();
    for (let i = 0; i < options.workingWeekdays.length; i++) {
      const weekday = options.workingWeekdays[i];
      if (
        typeof weekday !== "number" ||
        !Number.isInteger(weekday) ||
        weekday < 0 ||
        weekday > 6
      ) {
        throw new RangeError(`Invalid weekday in workingWeekdays: ${String(weekday)}`);
      }
      workingWeekdaysSet.add(weekday);
    }
  }

  let includeNationalHolidays = true;
  if (options.includeNationalHolidays !== undefined) {
    if (typeof options.includeNationalHolidays !== "boolean") {
      throw new RangeError("includeNationalHolidays must be a boolean");
    }
    includeNationalHolidays = options.includeNationalHolidays;
  }

  return {
    extraHolidaysSet,
    workingWeekdaysSet,
    includeNationalHolidays,
  };
}

function isDayBusiness(
  day: CalendarDay,
  year: number,
  monthDay: string,
  weekday: number,
  opts: ValidatedOptions,
): boolean {
  if (opts.extraHolidaysSet.has(day)) {
    return false;
  }
  if (!opts.workingWeekdaysSet.has(weekday)) {
    return false;
  }
  if (opts.includeNationalHolidays) {
    for (let i = 0; i < NATIONAL_FIXED_HOLIDAYS.length; i++) {
      const holiday = NATIONAL_FIXED_HOLIDAYS[i];
      if (
        holiday.monthDay === monthDay &&
        (holiday.fromYear === undefined || holiday.fromYear <= year)
      ) {
        return false;
      }
    }
  }
  return true;
}

/** True when the day is a working weekday and not a holiday. Throws RangeError on invalid input or options. */
export function isBusinessDay(day: CalendarDay, options?: CalendarOptions): boolean {
  if (!isValidCalendarDay(day)) {
    throw new RangeError(`Invalid calendar day: ${String(day)}`);
  }
  const opts = parseCalendarOptions(options);
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const dateNum = Number(day.slice(8, 10));
  const monthDay = day.slice(5, 10);
  const utcDate = new Date(Date.UTC(year, month - 1, dateNum));
  return isDayBusiness(day, year, monthDay, utcDate.getUTCDay(), opts);
}

interface ValidatedRange {
  readonly fromMs: number;
  readonly toMs: number;
  readonly opts: ValidatedOptions;
}

function validateRange(
  from: CalendarDay,
  to: CalendarDay,
  options?: CalendarOptions,
): ValidatedRange {
  if (!isValidCalendarDay(from)) {
    throw new RangeError(`Invalid from day: ${String(from)}`);
  }
  if (!isValidCalendarDay(to)) {
    throw new RangeError(`Invalid to day: ${String(to)}`);
  }
  const opts = parseCalendarOptions(options);

  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const fromDay = Number(from.slice(8, 10));
  const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);

  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  const toDay = Number(to.slice(8, 10));
  const toMs = Date.UTC(toYear, toMonth - 1, toDay);

  if (fromMs > toMs) {
    throw new RangeError("from must be less than or equal to to");
  }

  const spanDays = Math.round((toMs - fromMs) / MILLIS_PER_DAY) + 1;
  if (spanDays > MAX_SPAN_DAYS) {
    throw new RangeError(`Span of ${spanDays} days exceeds maximum of ${MAX_SPAN_DAYS}`);
  }

  return { fromMs, toMs, opts };
}

/** Business days between `from` and `to`, both ends counted. Throws RangeError if from > to, the span exceeds MAX_SPAN_DAYS, or any input or option is invalid. */
export function countBusinessDays(
  from: CalendarDay,
  to: CalendarDay,
  options?: CalendarOptions,
): number {
  const { fromMs, toMs, opts } = validateRange(from, to, options);
  let count = 0;
  let currentMs = fromMs;
  while (currentMs <= toMs) {
    const d = new Date(currentMs);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dayNum = d.getUTCDate();
    const monthDay = `${String(m).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const dayStr = `${y}-${monthDay}`;
    if (isDayBusiness(dayStr, y, monthDay, d.getUTCDay(), opts)) {
      count++;
    }
    currentMs += MILLIS_PER_DAY;
  }
  return count;
}

/** Same rules as countBusinessDays, returning the business days in ascending order. */
export function listBusinessDays(
  from: CalendarDay,
  to: CalendarDay,
  options?: CalendarOptions,
): CalendarDay[] {
  const { fromMs, toMs, opts } = validateRange(from, to, options);
  const result: CalendarDay[] = [];
  let currentMs = fromMs;
  while (currentMs <= toMs) {
    const d = new Date(currentMs);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dayNum = d.getUTCDate();
    const monthDay = `${String(m).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const dayStr = `${y}-${monthDay}`;
    if (isDayBusiness(dayStr, y, monthDay, d.getUTCDay(), opts)) {
      result.push(dayStr);
    }
    currentMs += MILLIS_PER_DAY;
  }
  return result;
}
