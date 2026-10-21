import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/catalog/options";
import { getPurchaseOrder } from "@/server/purchasing/service";
import { listStoreOptions } from "@/server/stores/options";
import { OrderForm } from "../../order-form";

export const metadata: Metadata = { title: "Editar pedido de compra" };

type Params = Promise<{ orderId: string }>;

export default async function EditPurchaseOrderPage({ params }: { params: Params }) {
  const context = await requireTenantContext();
  if (!can(context, "purchases.read")) return <AccessDenied />;
  if (!can(context, "purchases.manage") || !can(context, "catalog.costs.read")) {
    return <AccessDenied detail="Editar pedidos de compra exige permissão de compras e acesso aos custos dos produtos." />;
  }
  const { orderId } = await params;
  const order = await getPurchaseOrder(context, orderId);
  if (!order) notFound();
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Painel", href: "/painel" },
        { label: "Compras", href: "/compras" },
        { label: `Pedido nº ${order.number}`, href: `/compras/${order.id}` },
        { label: "Editar" },
      ]}
    />
  );
  if (order.status !== "draft") {
    return (
      <>
        {crumbs}
        <PageHeader title={`Editar pedido nº ${order.number}`} />
        <Notice tone="warning" title="Só pedidos em rascunho podem ser alterados." />
        <div>
          <LinkButton href={`/compras/${order.id}`} variant="secondary">
            Voltar ao pedido
          </LinkButton>
        </div>
      </>
    );
  }
  const [stores, options] = await Promise.all([listStoreOptions(context), listCatalogOptions(context, { supplierId: order.supplier.id })]);

  return (
    <>
      {crumbs}
      <PageHeader title={`Editar pedido nº ${order.number}`} description="Alterações substituem os itens do rascunho." />
      <OrderForm
        stores={stores.map(({ id, code, name }) => ({ id, code, name }))}
        suppliers={options.suppliers.map(({ id, name, isActive }) => ({ id, name: isActive ? name : `${name} (inativo)` }))}
        order={{
          id: order.id,
          storeId: order.store.id,
          supplierId: order.supplier.id,
          expectedDate: order.expectedDate,
          notes: order.notes,
          items: order.items.map((item) => ({
            variantId: item.variantId,
            label: `${item.productName} · ${item.variantName}`,
            sku: item.sku,
            unit: item.unit,
            quantity: item.quantityOrdered,
            unitCostCents: "unitCostCents" in item && typeof item.unitCostCents === "number" ? item.unitCostCents : 0,
          })),
        }}
      />
    </>
  );
}
