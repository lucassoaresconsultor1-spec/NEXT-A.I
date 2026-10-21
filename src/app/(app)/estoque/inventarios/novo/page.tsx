import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Notice } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/catalog/options";
import { MAX_COUNT_ITEMS } from "@/server/inventory/count-schemas";
import { listStoreOptions } from "@/server/stores/options";
import { OpenCountForm } from "./open-form";

export const metadata: Metadata = { title: "Novo inventário" };

export default async function NewCountPage() {
  const context = await requireTenantContext();
  if (!can(context, "inventory.count.manage")) return <AccessDenied />;
  const stores = await listStoreOptions(context);
  // Category and brand filters need catalog access; without it the count covers the whole store.
  const options = can(context, "catalog.read") ? await listCatalogOptions(context) : { categories: [], brands: [] };
  const defaultStoreId = stores.some((store) => store.id === context.activeStoreId) ? (context.activeStoreId ?? "") : "";
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Painel", href: "/painel" },
          { label: "Estoque", href: "/estoque" },
          { label: "Inventários", href: "/estoque/inventarios" },
          { label: "Novo inventário" },
        ]}
      />
      <PageHeader
        title="Novo inventário"
        description={`Entram os itens ativos do catálogo e qualquer item com saldo na loja, até ${MAX_COUNT_ITEMS.toLocaleString("pt-BR")} itens. Lojas grandes podem ser contadas por categoria ou marca.`}
      />
      <Card>
        <CardBody>
          {stores.length === 0 ? (
            <Notice tone="warning" title="Nenhuma loja ativa no seu acesso." />
          ) : (
            <OpenCountForm
              stores={stores.map(({ id, code, name }) => ({ id, code, name }))}
              categories={options.categories.map(({ id, name }) => ({ id, name }))}
              brands={options.brands.map(({ id, name }) => ({ id, name }))}
              defaultStoreId={defaultStoreId}
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}
