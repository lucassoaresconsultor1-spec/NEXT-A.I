import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { cashSessions, organizationMemberships, products, productVariants, salespeople, salespersonStores, stores } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { resolveMembershipStores, type TenantContext } from "@/server/authz/context";
import { currentCostCents, currentPriceCents } from "@/server/catalog/queries";
import { invalid, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";

// Checks shared by sale completion and suspension: parsing, store, cash
// session, salesperson and the sellable variants with their current price/cost.

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

export async function assertStoreActive(tx: Tx, organizationId: string, storeId: string) {
  const [store] = await tx.select({ status: stores.status }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.id, storeId)));
  if (!store) throw notFound("Loja não encontrada.");
  if (store.status !== "active") throw invalid("Lojas inativas não vendem.");
}

/** The member's own open cash session in the store, locked for the rest of the transaction. */
export async function lockOwnOpenSession(tx: Tx, context: TenantContext, storeId: string) {
  const [session] = await tx
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.organizationId, context.organization.id),
        eq(cashSessions.storeId, storeId),
        eq(cashSessions.openedBy, context.user.id),
        eq(cashSessions.status, "open"),
      ),
    )
    .for("update");
  if (!session) throw invalid("Abra o caixa antes de vender.");
  return session.id;
}

/** Salesperson must be an active member of the organization who reaches the store. */
export async function assertSalesperson(tx: Tx, organizationId: string, userId: string, storeId: string) {
  // With salespeople registered (m10a), only an active salesperson linked to the store counts.
  const [registered] = await tx.select({ id: salespeople.id }).from(salespeople).where(eq(salespeople.organizationId, organizationId)).limit(1);
  if (registered) {
    const [salesperson] = await tx
      .select({ id: salespeople.id })
      .from(salespeople)
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, salespeople.organizationId), eq(organizationMemberships.id, salespeople.membershipId)))
      .innerJoin(salespersonStores, and(eq(salespersonStores.organizationId, salespeople.organizationId), eq(salespersonStores.salespersonId, salespeople.id), eq(salespersonStores.storeId, storeId)))
      .where(and(eq(salespeople.organizationId, organizationId), eq(organizationMemberships.userId, userId), eq(salespeople.isActive, true), eq(organizationMemberships.status, "active")));
    if (!salesperson) throw invalid("Revise os campos destacados.", { salespersonUserId: ["Selecione um vendedor ativo desta loja."] });
    return;
  }
  const [membership] = await tx
    .select({ id: organizationMemberships.id, status: organizationMemberships.status, storeAccess: organizationMemberships.storeAccess })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId)));
  const reaches = membership?.status === "active" && (membership.storeAccess === "all" || (await resolveMembershipStores(tx, organizationId, membership.id)).includes(storeId));
  if (!reaches) throw invalid("Revise os campos destacados.", { salespersonUserId: ["Selecione um vendedor ativo desta loja."] });
}

export interface SellableVariant {
  id: string;
  productName: string;
  variantName: string;
  sku: string;
  unit: "un" | "kg" | "l" | "m";
  sellable: boolean;
  priceCents: number | null;
  costCents: number | null;
}

/** Variants with current price and cost, read in the sale transaction (the cost snapshot of ADR-016). */
export async function loadVariants(tx: Tx, organizationId: string, variantIds: string[]): Promise<Map<string, SellableVariant>> {
  const rows = await tx
    .select({
      id: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      unit: products.unit,
      variantActive: productVariants.isActive,
      productActive: products.isActive,
      priceCents: currentPriceCents,
      costCents: currentCostCents,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
    .where(and(eq(productVariants.organizationId, organizationId), inArray(productVariants.id, variantIds)));
  return new Map(
    rows.map(({ variantActive, productActive, ...row }) => [row.id, { ...row, sellable: variantActive && productActive }]),
  );
}

/** Sorts entries by variant id: every transaction locks balance rows in the same order. */
export function byVariant<T extends { variantId: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
}
