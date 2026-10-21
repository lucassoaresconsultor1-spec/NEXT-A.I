import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatQuantity } from "@/lib/quantity-format";
import { isStoreInScope, requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getTransfer } from "@/server/inventory/transfer-queries";
import { TRANSFER_STATUS_LABELS } from "@/server/inventory/transfer-schemas";
import { InventoryUnavailable, withInventoryPlan } from "../../feature-guard";
import { TRANSFER_TONES } from "../transfer-filters";
import { ApproveTransferDialog, CancelTransferDialog, DispatchTransferDialog, ReceiveTransferDialog } from "./transfer-dialogs";

export const metadata: Metadata = { title: "Transferência de estoque" };

type Params = Promise<{ transferId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TransferPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read")) return <AccessDenied />;
  const { transferId } = await params;
  const loaded = await withInventoryPlan(() => getTransfer(context, transferId));
  if ("unavailable" in loaded) return <InventoryUnavailable message={loaded.unavailable} />;
  const transfer = loaded.data;
  if (!transfer) notFound();
  const query = await searchParams;
  const tz = context.organization.timezone;
  const at = (value: Date | null) => (value ? formatDateTime(value, tz) : null);

  // Button visibility only; the service checks permission and side again.
  const originInScope = isStoreInScope(context.storeScope, transfer.originStoreId);
  const destinationInScope = isStoreInScope(context.storeScope, transfer.destinationStoreId);
  const canApprove = can(context, "inventory.transfer.approve") && originInScope;
  const canExecute = can(context, "inventory.transfer.execute");
  const canCancel =
    (transfer.status === "requested" && (canApprove || (can(context, "inventory.transfer.request") && destinationInScope))) ||
    (transfer.status === "approved" && canApprove);
  const dialogItems = transfer.items.map((item) => ({
    id: item.id,
    label: `${item.productName} · ${item.variantName}`,
    unit: item.unit,
    requested: item.quantityRequested,
    sent: item.quantitySent,
  }));

  const actions = (
    <>
      {transfer.status === "requested" && canApprove ? <ApproveTransferDialog transferId={transfer.id} number={transfer.number} /> : null}
      {transfer.status === "approved" && canExecute && originInScope ? (
        <DispatchTransferDialog transferId={transfer.id} number={transfer.number} items={dialogItems} />
      ) : null}
      {transfer.status === "in_transit" && canExecute && destinationInScope ? (
        <ReceiveTransferDialog transferId={transfer.id} number={transfer.number} items={dialogItems.filter((item) => item.sent !== null)} />
      ) : null}
      {canCancel ? <CancelTransferDialog transferId={transfer.id} number={transfer.number} /> : null}
    </>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Painel", href: "/painel" },
          { label: "Estoque", href: "/estoque" },
          { label: "Transferências", href: "/estoque/transferencias" },
          { label: `Nº ${transfer.number}` },
        ]}
      />
      <PageHeader
        title={`Transferência nº ${transfer.number}`}
        description={`${transfer.originStoreName} → ${transfer.destinationStoreName}`}
        actions={actions}
      />
      {query.criada === "1" ? <Notice tone="success" title="Transferência solicitada." /> : null}
      <Card>
        <CardHeader title="Dados da transferência" actions={<Badge tone={TRANSFER_TONES[transfer.status]}>{TRANSFER_STATUS_LABELS[transfer.status]}</Badge>} />
        <CardBody>
          <DetailList
            items={[
              { label: "Origem", value: transfer.originStoreName },
              { label: "Destino", value: transfer.destinationStoreName },
              { label: "Solicitada por", value: transfer.requestedByName },
              { label: "Solicitada em", value: at(transfer.requestedAt) },
              { label: "Aprovada em", value: at(transfer.approvedAt) },
              { label: "Despachada em", value: at(transfer.dispatchedAt) },
              { label: "Recebida em", value: at(transfer.receivedAt) },
              { label: "Observações", value: transfer.notes ? <span className="whitespace-pre-line">{transfer.notes}</span> : null },
              ...(transfer.cancelledAt
                ? [
                    { label: "Cancelada em", value: at(transfer.cancelledAt) },
                    { label: "Motivo do cancelamento", value: transfer.cancelReason },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Itens" />
        <div className="overflow-x-auto">
          <Table caption="Itens da transferência">
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>SKU</Th>
                <Th className="text-right">Solicitado</Th>
                <Th className="text-right">Enviado</Th>
                <Th className="text-right">Recebido</Th>
                <Th>Divergência</Th>
              </tr>
            </thead>
            <tbody>
              {transfer.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="font-medium">
                    {item.productName} · {item.variantName}
                  </Td>
                  <Td className="font-mono text-xs">{item.sku}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(item.quantityRequested, item.unit)}</Td>
                  <Td className="text-right tabular-nums">{item.quantitySent === null ? "—" : formatQuantity(item.quantitySent, item.unit)}</Td>
                  <Td className="text-right tabular-nums">{item.quantityReceived === null ? "—" : formatQuantity(item.quantityReceived, item.unit)}</Td>
                  <Td className="text-ink-soft">{item.divergenceReason ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </>
  );
}
