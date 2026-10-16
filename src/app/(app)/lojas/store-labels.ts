import { BRAZIL_TIMEZONES } from "@/lib/brazil";

// pt-BR presentation of store fields, shared by the list, detail and form.

export const STORE_STATUS_LABELS = { active: "Ativa", inactive: "Inativa" } as const;

export function storeStatusTone(status: "active" | "inactive") {
  return status === "active" ? "positive" : "neutral";
}

/** Full label, e.g. "Manaus (AM leste)"; unknown identifiers are shown as they are. */
export function timezoneLabel(value: string) {
  return BRAZIL_TIMEZONES.find((zone) => zone.value === value)?.label ?? value;
}

/** City part only, e.g. "Brasília", used inside other sentences. */
export function timezoneShortLabel(value: string) {
  return timezoneLabel(value).split(" (")[0];
}

export function inheritedTimezoneLabel(organizationTimezone: string) {
  return `Herdado da empresa (${timezoneShortLabel(organizationTimezone)})`;
}

export function cityState(city: string | null, state: string | null) {
  if (city && state) return `${city}/${state}`;
  return city ?? state ?? null;
}
