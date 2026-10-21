import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getPurchaseOrder } from "@/server/purchasing/service";
import { ReceiptForm } from "./receipt-form";

export const metadata: Metadata = { title: "Registrar recebimento" };

type Params = Promise<{ orderId: string }>;

export default async function ReceiveGoodsPage({ params }: { params: Params }) {
  const context = await requireTenantContext();
  if (!can(context, "purchases.read")) return <AccessDenied />;
  if (!can(context, "purchases.receive")) return <AccessDenied detail="Registrar recebimento exige a permissão de recebimento de mercadorias." />;
  const { orderId } = await params;
  const order = await getPurchaseOrder(context, orderId);
  if (!order) notFound();
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Painel", href: "/painel" },
        { label: "Compras", href: "/compras" },
        { label: `Pedido nº ${order.number}`, href: `/compras/${order.id}` },
        { label: "Recebimento" },
      ]}
    />
  );
  const receivable = order.status === "approved" || order.status === "partially_received";
  const lines = order.items
    .filter((item) => !/^0+(\.0+)?$/.test(item.quantityPending))
    .map((item) => ({
      orderItemId: item.id,
      label: `${item.productName} · ${item.variantName}`,
      sku: item.sku,
      unit: item.unit,
      pending: item.quantityPending,
    }));

  return (
    <>
      {crumbs}
      <PageHeader title={`Registrar recebimento do pedido nº ${order.number}`} description={`${order.supplier.name} → ${order.store.name}`} />
      {!receivable || lines.length === 0 ? (
        <>
          <Notice tone="warning" title="Este pedido não aceita recebimento." />
          <div>
            <LinkButton href={`/compras/${order.id}`} variant="secondary">
              Voltar ao pedido
            </LinkButton>
          </div>
        </>
      ) : (
        <Card>
          <CardBody>
            {/* New key per render: resubmitting this form replays; reloading the page starts a new receipt. */}
            <ReceiptForm orderId={order.id} number={order.number} idempotencyKey={randomUUID()} lines={lines} />
          </CardBody>
        </Card>
      )}
    </>
  );
}
