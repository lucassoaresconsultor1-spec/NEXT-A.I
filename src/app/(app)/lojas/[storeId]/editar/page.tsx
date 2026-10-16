import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listRegionOptions } from "@/server/regions/service";
import { getStore } from "@/server/stores/service";
import { StoreForm, type RegionChoice, type StoreFormValues } from "../../store-form";

export const metadata: Metadata = { title: "Editar loja" };

/** Moving a store between regions changes who sees it, so only organization-wide members may do it. */
async function regionChoiceFor(context: TenantContext): Promise<RegionChoice> {
  if (!context.storeScope.all) {
    return { locked: true, reason: "Mudar a região exige acesso a todas as lojas da empresa; a região atual será mantida." };
  }
  if (!can(context, "regions.read")) {
    return { locked: true, reason: "Seu perfil não inclui acesso às regiões; a região atual será mantida." };
  }
  return { locked: false, options: await listRegionOptions(context) };
}

export default async function EditStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const context = await requireTenantContext();
  if (!can(context, "stores.read") || !can(context, "stores.manage")) return <AccessDenied />;
  const { storeId } = await params;
  const [store, regions] = await Promise.all([getStore(context, storeId), regionChoiceFor(context)]);
  if (!store) notFound();
  const values: StoreFormValues = {
    id: store.id,
    code: store.code,
    name: store.name,
    document: store.document,
    phone: store.phone,
    email: store.email,
    postalCode: store.postalCode,
    street: store.street,
    number: store.number,
    complement: store.complement,
    district: store.district,
    city: store.city,
    state: store.state,
    timezone: store.timezone,
    regionId: store.regionId,
    regionName: store.regionName,
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Painel", href: "/painel" },
          { label: "Lojas", href: "/lojas" },
          { label: store.name, href: `/lojas/${store.id}` },
          { label: "Editar" },
        ]}
      />
      <PageHeader title={`Editar ${store.name}`} description={`Código atual: ${store.code}. Apenas código e nome são obrigatórios.`} />
      <StoreForm store={values} regions={regions} organizationTimezone={context.organization.timezone} cancelHref={`/lojas/${store.id}`} />
    </>
  );
}
