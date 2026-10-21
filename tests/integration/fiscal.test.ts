import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { fiscalDocuments } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { setFiscalProviderForTests } from "@/server/fiscal/registry";
import { fiscalFiltersSchema } from "@/server/fiscal/schemas";
import { getFiscalDocumentForSale, listFiscalDocuments, refreshFiscalDocument, requestFiscalDocument } from "@/server/fiscal/service";
import { recordMovement } from "@/server/inventory/service";
import { completeSale } from "@/server/sales/complete";
import { suspendSale } from "@/server/sales/suspend";
import { createFakeFiscalProvider } from "../support/fake-fiscal-provider";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

afterEach(() => setFiscalProviderForTests(undefined));

const accessKey = "3".repeat(44);

async function setup() {
  const org = await createOrganizationFixture();
  const storeId = await createStoreFixture(org.organizationId);
  const { variantId } = await createVariantFixture(org.organizationId);
  await setPriceFixture(org.organizationId, variantId, 1000);
  await recordMovement(org.owner, { storeId, variantId, type: "entry", quantity: "10", reason: "Estoque inicial" });
  const cashier = await addMemberFixture(org.organizationId, { roleKey: "cashier", storeIds: [storeId] });
  await openCashSessionFixture(org.organizationId, storeId, cashier.userId);
  const sale = await completeSale(cashier.context, {
    completionKey: randomUUID(),
    storeId,
    items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1000 }],
    payments: [{ method: "cash", amountCents: 1000, tenderedCents: 1000 }],
  });
  return { ...org, storeId, variantId, cashier: cashier.context, saleId: sale.saleId };
}

describe("fiscal documents", () => {
  it("records not_configured without a provider and never fills fiscal fields", async () => {
    const s = await setup();
    setFiscalProviderForTests(null);
    const document = await requestFiscalDocument(s.cashier, s.saleId);
    expect(document.status).toBe("not_configured");
    expect(await requestFiscalDocument(s.cashier, s.saleId)).toEqual(document);
    expect(await getFiscalDocumentForSale(s.cashier, s.saleId)).toMatchObject({ status: "not_configured", provider: null, accessKey: null, number: null, protocol: null });
  });

  it("follows the provider from pending to authorized, storing only the provider values", async () => {
    const s = await setup();
    const provider = createFakeFiscalProvider();
    setFiscalProviderForTests(provider);
    const { id, status } = await requestFiscalDocument(s.cashier, s.saleId);
    expect(status).toBe("pending");
    // An incomplete authorization is not accepted as authorized.
    provider.setRemote(`fiscal-${s.saleId}`, { status: "authorized", accessKey: "123", number: "1", protocol: "2" });
    expect((await refreshFiscalDocument(s.cashier, id)).status).toBe("pending");
    provider.setRemote(`fiscal-${s.saleId}`, { status: "authorized", accessKey, number: "123", series: "1", protocol: "135260000000001" });
    expect((await refreshFiscalDocument(s.cashier, id)).status).toBe("authorized");
    expect(await getFiscalDocumentForSale(s.owner, s.saleId)).toMatchObject({ status: "authorized", accessKey, number: "123", series: "1", protocol: "135260000000001" });
  });

  it("keeps the rejection reason", async () => {
    const s = await setup();
    const provider = createFakeFiscalProvider();
    setFiscalProviderForTests(provider);
    const { id } = await requestFiscalDocument(s.cashier, s.saleId);
    provider.setRemote(`fiscal-${s.saleId}`, { status: "rejected", rejectionReason: "Rejeição 778: NCM inexistente" });
    expect((await refreshFiscalDocument(s.cashier, id)).status).toBe("rejected");
    const listed = await listFiscalDocuments(s.owner, fiscalFiltersSchema.parse({}));
    expect(listed.rows[0]).toMatchObject({ id, status: "rejected", rejectionReason: "Rejeição 778: NCM inexistente", saleNumber: 1 });
  });

  it("refuses suspended sales, other organizations and authorized rows without fiscal fields", async () => {
    const s = await setup();
    const { saleId: suspended } = await suspendSale(s.cashier, { storeId: s.storeId, items: [{ variantId: s.variantId, quantity: "1" }] });
    await expect(requestFiscalDocument(s.cashier, suspended)).rejects.toMatchObject({ code: "invalid" });
    const other = await createOrganizationFixture();
    await expect(requestFiscalDocument(other.owner, s.saleId)).rejects.toMatchObject({ code: "not_found" });

    const { id } = await requestFiscalDocument(s.cashier, s.saleId);
    await expect(
      withScope({ organizationId: s.organizationId }, (tx) => tx.update(fiscalDocuments).set({ status: "authorized" }).where(eq(fiscalDocuments.id, id))),
    ).rejects.toThrow();
    const seen = await withScope({ organizationId: other.organizationId }, (tx) => tx.select({ id: fiscalDocuments.id }).from(fiscalDocuments));
    expect(seen).toHaveLength(0);
    const seller = await addMemberFixture(s.organizationId, { roleKey: "salesperson", storeIds: [s.storeId] });
    await expect(listFiscalDocuments(seller.context, fiscalFiltersSchema.parse({}))).rejects.toMatchObject({ code: "forbidden" });
  });
});
