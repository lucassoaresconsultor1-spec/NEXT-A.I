// Port for fiscal document providers (NFC-e/NF-e), ADR-005. Every fiscal field
// (access key, number, series, protocol) comes only from the provider; nothing
// is generated locally. No real adapter is registered in this delivery.

export type FiscalStatus = "not_configured" | "pending" | "authorized" | "rejected" | "cancelled" | "contingency";

export interface FiscalIssueInput {
  saleId: string;
  storeDocument: string | null;
  totalCents: number;
  items: { description: string; quantity: string; unitPriceCents: number; totalCents: number }[];
}

export interface FiscalProviderStatus {
  status: FiscalStatus;
  accessKey?: string;
  number?: string;
  series?: string;
  protocol?: string;
  rejectionReason?: string;
}

export interface FiscalProvider {
  readonly key: string;
  issue(input: FiscalIssueInput): Promise<{ providerReference: string; status: FiscalStatus }>;
  getStatus(providerReference: string): Promise<FiscalProviderStatus>;
  cancel(providerReference: string, reason: string): Promise<{ status: FiscalStatus }>;
}
