// Pure helpers shared by the demo engine and the UI (no DOM, importable in Node).

export const TZ = "America/Sao_Paulo";
// Brazil has no daylight saving time since 2019: São Paulo is a fixed UTC−3.
export const SP_OFFSET_MS = 3 * 3600_000;
export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

/** Deterministic PRNG (mulberry32), so every visitor gets the same fictitious data set. */
export function createRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items, weightOf) => {
      const total = items.reduce((sum, item) => sum + weightOf(item), 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= weightOf(item);
        if (roll <= 0) return item;
      }
      return items[items.length - 1];
    },
  };
}

const brlFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const intFormat = new Intl.NumberFormat("pt-BR");

/** Money is always integer cents; formatting is the only place it becomes reais. */
export const brl = (cents) => brlFormat.format(cents / 100);
export const int = (value) => intFormat.format(Math.round(value));
export function pct(ratio, digits = 1) {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
export const decimal = (value, digits = 1) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Calendar day (YYYY-MM-DD) of an instant in São Paulo. */
export const dayKey = (ms) => new Date(ms - SP_OFFSET_MS).toISOString().slice(0, 10);
export const monthKey = (ms) => dayKey(ms).slice(0, 7);
/** Instant of 00:00 in São Paulo for a day key. */
export const dayStart = (key) => Date.parse(`${key}T03:00:00Z`);
export const addDays = (key, days) => dayKey(dayStart(key) + days * DAY_MS + 12 * 3600_000);
export const spHour = (ms) => new Date(ms - SP_OFFSET_MS).getUTCHours() + new Date(ms - SP_OFFSET_MS).getUTCMinutes() / 60;
export function daysInMonth(month) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}
export function previousMonth(month) {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

export const time = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const timeSeconds = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { timeZone: TZ });
export const date = (ms) => new Date(ms).toLocaleDateString("pt-BR", { timeZone: TZ });
export const dateTime = (ms) => `${date(ms)} ${time(ms)}`;
export const shortDay = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
export function monthLabel(month) {
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function minutesLabel(minutes) {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  return minutes < 1 ? "< 1 min" : `${decimal(minutes, minutes < 10 ? 1 : 0)} min`;
}

/** EAN-13 check digit (GS1 mod 10). Prefix 2 = restricted circulation: never collides with real products. */
export function ean13(first12) {
  const digits = first12.split("").map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return first12 + ((10 - (sum % 10)) % 10);
}

/** CPF check digits (Receita Federal mod 11). Accepts formatted or bare input. */
export function isValidCpf(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length) => {
    const sum = digits
      .slice(0, length)
      .split("")
      .reduce((acc, digit, index) => acc + Number(digit) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** Parses "12,50" / "12.50" / "1.234,56" typed in pt-BR into integer cents (null when invalid). */
export function parseCents(text) {
  const clean = String(text).trim().replace(/\s|R\$/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

export const sum = (items, valueOf) => items.reduce((acc, item) => acc + valueOf(item), 0);
export const ratio = (part, whole) => (whole > 0 ? part / whole : null);
export function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}
export const normalize = (text) =>
  String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
