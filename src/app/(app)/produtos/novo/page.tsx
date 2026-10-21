import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/catalog/options";
import { NewProductForm } from "./new-product-form";

export const metadata: Metadata = { title: "Novo produto" };

export default async function NewProductPage() {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const canManage = can(context, "catalog.manage") && context.storeScope.all;
  if (!canManage) return <AccessDenied detail="Cadastrar produtos exige permissão de catálogo e acesso a todas as lojas." />;
  const options = await listCatalogOptions(context);
  const canManageCosts = can(context, "catalog.costs.read");

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Produtos", href: "/produtos" }, { label: "Novo produto" }]} />
      <PageHeader title="Novo produto" description="Cadastre o produto e as variações que serão vendidas e estocadas." />
      <NewProductForm options={options} canManageCosts={canManageCosts} />
    </>
  );
}
