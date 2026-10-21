import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listStoreOptions } from "@/server/stores/options";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Nova transferência" };

export default async function NewTransferPage() {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read") || !can(context, "inventory.transfer.request")) return <AccessDenied />;
  // Active stores of the member's scope: every active store of the company when the member reaches all of them.
  const stores = (await listStoreOptions(context)).map(({ id, code, name }) => ({ id, code, name }));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Painel", href: "/painel" },
          { label: "Estoque", href: "/estoque" },
          { label: "Transferências", href: "/estoque/transferencias" },
          { label: "Nova transferência" },
        ]}
      />
      <PageHeader title="Nova transferência" description="Solicite mercadorias de uma loja para outra. A origem aprova, reserva e despacha." />
      <TransferForm originStores={stores} destinationStores={stores} partialScope={!context.storeScope.all} />
    </>
  );
}
