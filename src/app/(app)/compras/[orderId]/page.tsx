import { PackageCheck, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { formatQuantity, type QuantityUnit } from "@/lib/quantity-format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/server/purchasing/schemas";
import { getPurchaseOrder } from "@/server/purchasing/service";
import { formatCalendarDate, STATUS_TONES } from "../purchase-filters";
import { ApproveOrderDialog, ReasonOrderDialog } from "./order-dialogs";

export const metadata: Metadata = { title: "Pedido de compra" };

type Params = Promise<{ orderId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PurchaseOrderPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "purchases.read")) return <AccessDenied />;
  const { orderId } = await params;
  const order = await getPurchaseOrder(context, orderId);
  if (!order) notFound();
  const query = await searchParams;
  const tz = context.organization.timezone;
  const canEdit = order.status === "draft" && can(context, "purchases.manage") && can(context, "catalog.costs.read");
  const canApprove = can(context, "purchases.approve");
  const canReceive = can(context, "purchases.receive") && (order.status === "approved" || order.status === "partially_received");
  const hasReceipts = order.receipts.length > 0;
  // The service omits costs without catalog.costs.read; the column only exists when they come back.
  const showCost = order.items.some((item) => "unitCostCents" in item);
  const units = new Map(order.items.map((item) => [item.id, item.unit as QuantityUnit]));
  const labels = new Map(order.items.map((item) => [item.id, `${item.productName} · ${item.variantName}`]));

  const actions = (
    <>
      {canEdit ? (
        <LinkButton href={`/compras/${order.id}/editar`} variant="secondary" aria-label={`Editar pedido nº ${order.number}`}>
          <Pencil className="size-4" aria-hidden /> Editar
        </LinkButton>
      ) : null}
      {canApprove && order.status === "draft" ? <ApproveOrderDialog orderId={order.id} number={order.number} /> : null}
      {canApprove && (order.status === "draft" || (order.status === "approved" && !hasReceipts)) ? (
        <ReasonOrderDialog orderId={order.id} number={order.number} kind="cancel" />
      ) : null}
      {canApprove && order.status === "partially_received" ? <ReasonOrderDialog orderId={order.id} number={order.number} kind="close" /> : null}
      {canReceive ? (
        <LinkButton href={`/compras/${order.id}/receber`} aria-label={`Registrar recebimento do pedido nº ${order.number}`}>
          <PackageCheck className="size-4" aria-hidden /> Registrar recebimento
        </LinkButton>
      ) : null}
    </>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Compras", href: "/compras" }, { label: `Pedido nº ${order.number}` }]} />
      <PageHeader title={`Pedido de compra nº ${order.number}`} description={`${order.supplier.name} → ${order.store.name}`} actions={actions} />
      {query.salvo === "1" ? <Notice tone="success" title="Pedido salvo." /> : null}
      {query.recebido === "1" ? <Notice tone="success" title="Recebimento registrado. As entradas foram lançadas no estoque." /> : null}
      <Card>
        <CardHeader title="Dados do pedido" actions={<Badge tone={STATUS_TONES[order.status]}>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</Badge>} />
        <CardBody>
          <DetailList
            items={[
              { label: "Loja", value: `${order.store.code} · ${order.store.name}` },
              { label: "Fornecedor", value: order.supplier.name },
              { label: "Previsão", value: formatCalendarDate(order.expectedDate) },
              { label: "Observações", value: order.notes ? <span className="whitespace-pre-line">{order.notes}</span> : null },
              { label: "Criado em", value: formatDateTime(order.createdAt, tz) },
              { label: "Aprovado em", value: order.approvedAt ? formatDateTime(order.approvedAt, tz) : null },
              ...(order.cancelledAt ? [{ label: "Cancelado em", value: `${formatDateTime(order.cancelledAt, tz)} · ${order.cancelReason ?? ""}` }] : []),
              ...(order.closedAt ? [{ label: "Encerrado em", value: `${formatDateTime(order.closedAt, tz)} · ${order.closeReason ?? ""}` }] : []),
              ...("totalCents" in order && typeof order.totalCents === "number" ? [{ label: "Total", value: formatCurrencyCents(order.totalCents) }] : []),
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Itens" />
        <div className="overflow-x-auto">
          <Table caption="Itens do pedido">
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>SKU</Th>
                <Th className="text-right">Pedido</Th>
                <Th className="text-right">Recebido</Th>
                <Th className="text-right">Pendente</Th>
                {showCost ? <Th className="text-right">Custo unitário</Th> : null}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="font-medium">
                    {item.productName} · {item.variantName}
                  </Td>
                  <Td className="font-mono text-xs">{item.sku}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(item.quantityOrdered, item.unit)}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(item.quantityReceived, item.unit)}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(item.quantityPending, item.unit)}</Td>
                  {showCost ? (
                    <Td className="text-right tabular-nums">
                      {"unitCostCents" in item && typeof item.unitCostCents === "number" ? formatCurrencyCents(item.unitCostCents) : "—"}
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Recebimentos" />
        {hasReceipts ? (
          <div className="overflow-x-auto">
            <Table caption="Recebimentos registrados">
              <thead>
                <tr>
                  <Th>Data e hora</Th>
                  <Th>Responsável</Th>
                  <Th>Itens recebidos</Th>
                  <Th>Observações</Th>
                </tr>
              </thead>
              <tbody>
                {order.receipts.map((receipt) => (
                  <Tr key={receipt.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(receipt.receivedAt, tz)}</Td>
                    <Td className="text-ink-soft">{receipt.receivedByName ?? "—"}</Td>
                    <Td>
                      <ul className="space-y-0.5 text-sm">
                        {receipt.items.map((line) => (
                          <li key={line.orderItemId}>
                            {labels.get(line.orderItemId) ?? "—"}: <span className="tabular-nums">{formatQuantity(line.quantity, units.get(line.orderItemId))}</span>
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td className="text-ink-soft">{receipt.notes ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-muted">Nenhum recebimento registrado.</p>
          </CardBody>
        )}
      </Card>
    </>
  );
}
