import { z } from "zod";
import { parsePage } from "@/server/pagination";
import type { FiscalProviderStatus, FiscalStatus } from "./port";

// Pure rules for fiscal documents: labels, filters and how a provider answer is
// accepted. Fiscal fields are only stored when the provider returns them.

export const FISCAL_STATUSES = ["not_configured", "pending", "authorized", "rejected", "cancelled", "contingency"] as const satisfies readonly FiscalStatus[];

export const FISCAL_STATUS_LABELS: Record<FiscalStatus, string> = {
  not_configured: "Emissão fiscal não configurada",
  pending: "Aguardando o provedor",
  authorized: "Autorizado",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
  contingency: "Em contingência",
};

export const fiscalFiltersSchema = z.object({
  status: z.enum(FISCAL_STATUSES).optional().catch(undefined),
  storeId: z.uuid().optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type FiscalFilters = z.output<typeof fiscalFiltersSchema>;

const ACCESS_KEY = /^\d{44}$/;

/**
 * Normalizes a provider answer: an "authorized" answer without a valid 44-digit
 * access key, a number and a protocol is treated as still pending, so an
 * incomplete authorization is never shown as valid.
 */
export function acceptProviderStatus(answer: FiscalProviderStatus): FiscalProviderStatus {
  if (answer.status !== "authorized") return { status: answer.status, rejectionReason: answer.rejectionReason?.slice(0, 500) };
  const complete = Boolean(answer.accessKey && ACCESS_KEY.test(answer.accessKey) && answer.number && answer.protocol);
  if (!complete) return { status: "pending" };
  return {
    status: "authorized",
    accessKey: answer.accessKey,
    number: answer.number?.slice(0, 20),
    series: answer.series?.slice(0, 5),
    protocol: answer.protocol?.slice(0, 40),
  };
}
