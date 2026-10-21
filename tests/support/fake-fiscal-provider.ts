import type { FiscalProvider, FiscalProviderStatus } from "@/server/fiscal/port";

// TEST-ONLY fiscal adapter, injected with setFiscalProviderForTests. The values
// it returns are obviously fake and exist only to exercise the state machine.

export function createFakeFiscalProvider() {
  const documents = new Map<string, FiscalProviderStatus>();
  const provider: FiscalProvider & { setRemote(reference: string, status: FiscalProviderStatus): void } = {
    key: "teste-fiscal",
    async issue(input) {
      const providerReference = `fiscal-${input.saleId}`;
      documents.set(providerReference, { status: "pending" });
      return { providerReference, status: "pending" };
    },
    async getStatus(providerReference) {
      return documents.get(providerReference) ?? { status: "rejected", rejectionReason: "Documento desconhecido no provedor de teste" };
    },
    async cancel(providerReference) {
      documents.set(providerReference, { ...(documents.get(providerReference) ?? { status: "pending" }), status: "cancelled" });
      return { status: "cancelled" };
    },
    setRemote(reference, status) {
      documents.set(reference, status);
    },
  };
  return provider;
}
