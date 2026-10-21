import "server-only";
import { and, eq } from "drizzle-orm";
import { importRows, inventoryMovements } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { TenantContext } from "@/server/authz/context";
import { createProductInTx } from "@/server/catalog/service";
import { createCustomerInTx } from "@/server/customers/service";
import { invalid } from "@/server/errors";
import { lockBalance, postLedgerEntry } from "@/server/inventory/ledger";
import { fromDbQuantity } from "@/server/inventory/quantity";
import type { ImportKind } from "./schemas";

// Applies one unit of an import (a product with its variants, a customer or an
// opening balance) inside the caller's savepoint, through the same in-transaction
// functions the screens use: validation, permissions and audit are theirs.

export type ImportRow = typeof importRows.$inferSelect;

export const OPENING_REASON = "Saldo inicial importado";

/** Returns the created id for each row of the unit, in the same order. */
export async function applyUnit(tx: Tx, context: TenantContext, kind: ImportKind, storeId: string | null, rows: ImportRow[]): Promise<string[]> {
  if (kind === "products") {
    const first = rows[0];
    const created = await createProductInTx(tx, context, {
      name: first.productName!,
      description: first.description ?? undefined,
      unit: first.unit as "un" | "kg" | "l" | "m",
      categoryId: first.categoryId,
      brandId: first.brandId,
      variants: rows.map((row) => ({ name: row.variantName!, sku: row.sku!, barcode: row.barcode ?? undefined, priceCents: row.priceCents ?? undefined })),
    });
    return created.variantIds;
  }
  const [row] = rows;
  if (kind === "customers") {
    const created = await createCustomerInTx(tx, context, { name: row.customerName, document: row.document ?? "", email: row.email ?? "", phone: row.phone ?? "", marketingConsent: false });
    return [created.id];
  }
  // Opening stock: the balance lock serializes with sales and movements, then "no movement yet" is checked again.
  const orgId = context.organization.id;
  await lockBalance(tx, orgId, storeId!, row.variantId!);
  const [moved] = await tx
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.storeId, storeId!), eq(inventoryMovements.variantId, row.variantId!)))
    .limit(1);
  if (moved) throw invalid("O item já tem movimentações nesta loja: lance um inventário em vez do saldo inicial.");
  const movement = await postLedgerEntry(tx, context, { storeId: storeId!, variantId: row.variantId!, type: "entry", quantityMilli: fromDbQuantity(row.quantity!), reason: OPENING_REASON });
  return [movement.id];
}
