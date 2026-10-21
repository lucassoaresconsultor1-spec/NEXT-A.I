import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/catalog/options";
import { listStoreOptions } from "@/server/stores/options";
import { OrderForm } from "../order-form";

export const metadata: Metadata = { title: "Novo pedido de compra" };

export default async function NewPurchaseOrderPage() {
  const context = await requireTenantContext();
  if (!can(context, "purchases.read")) return <AccessDenied />;
  // Orders carry unit costs: writing them needs purchases.manage and catalog.costs.read (the service checks again).
  if (!can(context, "purchases.manage") || !can(context, "catalog.costs.read")) {
    return <AccessDenied detail="Criar pedidos de compra exige permissão de compras e acesso aos custos dos produtos." />;
  }
  const [stores, options] = await Promise.all([listStoreOptions(context), listCatalogOptions(context)]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Compras", href: "/compras" }, { label: "Novo pedido" }]} />
      <PageHeader title="Novo pedido de compra" description="O pedido fica em rascunho até ser aprovado; o recebimento lança as entradas no estoque." />
      <OrderForm
        stores={stores.map(({ id, code, name }) => ({ id, code, name }))}
        suppliers={options.suppliers.map(({ id, name }) => ({ id, name }))}
      />
    </>
  );
}
