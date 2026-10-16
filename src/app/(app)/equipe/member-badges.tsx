import { Badge } from "@/components/ui/feedback";

// Labels shared by the team pages (server components and client forms).

export type MemberStatusValue = "active" | "suspended";
export type StoreAccessValue = "all" | "regions" | "stores";

export const MEMBER_STATUS_LABELS: Record<MemberStatusValue, string> = {
  active: "Ativo",
  suspended: "Suspenso",
};

export const STORE_ACCESS_LABELS: Record<StoreAccessValue, string> = {
  all: "Todas as lojas",
  regions: "Regiões",
  stores: "Lojas específicas",
};

export function MemberStatusBadge({ status }: { status: MemberStatusValue }) {
  return <Badge tone={status === "active" ? "positive" : "attention"}>{MEMBER_STATUS_LABELS[status]}</Badge>;
}

/** "Todas as lojas", or the first scope names plus how many more the viewer can see. */
export function scopeSummary(storeAccess: StoreAccessValue, names: string[], total: number) {
  if (storeAccess === "all") return STORE_ACCESS_LABELS.all;
  const prefix = storeAccess === "regions" ? "Regiões" : "Lojas";
  if (total === 0) return `${prefix}: nenhuma`;
  const extra = total - names.length;
  return `${prefix}: ${names.join(", ")}${extra > 0 ? ` +${extra}` : ""}`;
}
