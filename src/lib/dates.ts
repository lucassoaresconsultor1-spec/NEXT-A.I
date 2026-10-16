// Calendar helpers that respect an IANA time zone (stores operate in local time).

/** Start of a calendar day (YYYY-MM-DD) in an IANA time zone, as a UTC instant. */
export function zonedDayStart(day: string, timeZone: string, addDays = 0) {
  const [year, month, date] = day.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, date + addDays);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asZoned = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(utcGuess - (asZoned - utcGuess));
}
