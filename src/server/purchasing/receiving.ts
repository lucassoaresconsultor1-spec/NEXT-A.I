import "server-only";
import { and, eq } from "drizzle-orm";
import { goodsReceiptItems, goodsReceipts, purchaseOrderItems, purchaseOrders } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { recordCostInTx } from "@/server/catalog/pricing";
import { conflict, invalid, isUniqueViolation } from "@/server/errors";
import { postLedgerEntry } from "@/server/inventory/ledger";
import { fromDbQuantity, toDbQuantity, ZERO } from "@/server/inventory/quantity";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { lockOrder, ORDER_NOT_FOUND, parse } from "./queries";
import { receiptInputSchema } from "./schemas";

// Goods receipt against an approved order, in one transaction: ledger entries,
// replacement cost, received quantities, order status and audit. The
// idempotency key makes a retried submission return the first receipt.

const RECEIVABLE = new Set(["approved", "partially_received"]);
const KEY_CONSTRAINT = "goods_receipts_org_key_key";

async function findReceiptByKey(tx: Tx, organizationId: string, key: string) {
  const [row] = await tx
    .select({ id: goodsReceipts.id, orderId: goodsReceipts.orderId })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.organizationId, organizationId), eq(goodsReceipts.idempotencyKey, key)));
  return row ?? null;
}

export async function receiveGoods(context: TenantContext, orderId: string, rawInput: unknown): Promise<{ receiptId: string; replayed: boolean }> {
  assertCan(context, "purchases.receive");
  const input = parse(receiptInputSchema, rawInput);
  if (!isUuid(orderId)) throw ORDER_NOT_FOUND();
  const orgId = context.organization.id;
  try {
    return await withScope(dbScope(context), async (tx) => {
      await assertFeature(tx, orgId, "inventory");
      const order = await lockOrder(tx, context, orderId);
      if (!order) throw ORDER_NOT_FOUND();
      // Checked under the order lock: a concurrent retry with the same key sees the committed receipt.
      const previous = await findReceiptByKey(tx, orgId, input.idempotencyKey);
      if (previous) {
        if (previous.orderId !== orderId) throw conflict("Chave de recebimento já usada.");
        return { receiptId: previous.id, replayed: true };
      }
      if (!RECEIVABLE.has(order.status)) throw invalid("Este pedido não aceita recebimento.");

      const orderItems = await tx
        .select({
          id: purchaseOrderItems.id,
          variantId: purchaseOrderItems.variantId,
          ordered: purchaseOrderItems.quantityOrdered,
          received: purchaseOrderItems.quantityReceived,
          unitCostCents: purchaseOrderItems.unitCostCents,
        })
        .from(purchaseOrderItems)
        .where(and(eq(purchaseOrderItems.organizationId, orgId), eq(purchaseOrderItems.orderId, orderId)))
        .for("update");
      const byId = new Map(orderItems.map((item) => [item.id, item]));
      const errors: Record<string, string[]> = {};
      input.items.forEach((line, index) => {
        const item = byId.get(line.orderItemId);
        if (!item) {
          errors[`items.${index}.orderItemId`] = ["Item não pertence a este pedido."];
          return;
        }
        const pending = fromDbQuantity(item.ordered) - fromDbQuantity(item.received);
        if (line.quantity > pending) errors[`items.${index}.quantity`] = [`Quantidade acima do pendente (${toDbQuantity(pending)}).`];
      });
      if (Object.keys(errors).length > 0) throw invalid("Revise os campos destacados.", errors);

      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({ organizationId: orgId, orderId, storeId: order.storeId, idempotencyKey: input.idempotencyKey, notes: input.notes ?? null, receivedBy: context.user.id })
        .returning({ id: goodsReceipts.id });

      const received = new Map(orderItems.map((item) => [item.id, fromDbQuantity(item.received)]));
      const reason = `Recebimento do pedido de compra nº ${order.number}`;
      // Ascending variant order: concurrent receipts lock balances in the same order (no deadlock).
      const lines = input.items.map((line) => ({ ...line, item: byId.get(line.orderItemId)! }));
      lines.sort((a, b) => (a.item.variantId < b.item.variantId ? -1 : a.item.variantId > b.item.variantId ? 1 : 0));
      for (const line of lines) {
        const movement = await postLedgerEntry(tx, context, {
          storeId: order.storeId,
          variantId: line.item.variantId,
          type: "entry",
          quantityMilli: line.quantity,
          reason,
        });
        await recordCostInTx(tx, orgId, context.user.id, line.item.variantId, line.item.unitCostCents, "purchase_receipt");
        await tx.insert(goodsReceiptItems).values({
          organizationId: orgId,
          receiptId: receipt.id,
          orderItemId: line.item.id,
          variantId: line.item.variantId,
          quantity: toDbQuantity(line.quantity),
          unitCostCents: line.item.unitCostCents,
          movementId: movement.id,
        });
        const total = (received.get(line.item.id) ?? ZERO) + line.quantity;
        received.set(line.item.id, total);
        await tx
          .update(purchaseOrderItems)
          .set({ quantityReceived: toDbQuantity(total), updatedAt: new Date() })
          .where(and(eq(purchaseOrderItems.organizationId, orgId), eq(purchaseOrderItems.id, line.item.id)));
      }

      const complete = orderItems.every((item) => (received.get(item.id) ?? ZERO) >= fromDbQuantity(item.ordered));
      const status = complete ? "received" : "partially_received";
      await tx
        .update(purchaseOrders)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.id, orderId)));
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "goods_receipt.recorded",
        entityType: "goods_receipt",
        entityId: receipt.id,
        storeId: order.storeId,
        changes: {
          orderId,
          number: order.number,
          status: { from: order.status, to: status },
          items: lines.map((line) => ({ orderItemId: line.item.id, variantId: line.item.variantId, quantity: toDbQuantity(line.quantity) })),
        },
      });
      return { receiptId: receipt.id, replayed: false };
    });
  } catch (error) {
    // Two first-time submissions with the same key on different orders race past the check.
    if (isUniqueViolation(error, KEY_CONSTRAINT)) throw conflict("Chave de recebimento já usada.");
    throw error;
  }
}
