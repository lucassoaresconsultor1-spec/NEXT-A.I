import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Notice } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listRegionOptions } from "@/server/regions/service";
import { getStorePlanUsage } from "@/server/stores/service";
import { StoreForm, type RegionChoice } from "../store-form";

export const metadata: Metadata = { title: "Nova loja" };

export default async function NewStorePage() {
  const context = await requireTenantContext();
  if (!can(context, "stores.read") || !can(context, "stores.manage")) return <AccessDenied />;
  if (!context.storeScope.all) {
    return <AccessDenied detail="Cadastrar lojas exige acesso a todas as lojas da empresa. Fale com um administrador." />;
  }
  const [usage, regionOptions] = await Promise.all([
    getStorePlanUsage(context),
    can(context, "regions.read") ? listRegionOptions(context) : Promise.resolve(null),
  ]);
  const regions: RegionChoice = regionOptions
    ? { locked: false, options: regionOptions }
    : { locked: true, reason: "Seu perfil não inclui acesso às regiões; a loja será cadastrada sem região." };
  const atLimit = usage.maxStores !== null && usage.activeStores >= usage.maxStores;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Lojas", href: "/lojas" }, { label: "Nova loja" }]} />
      <PageHeader
        title="Nova loja"
        description="A loja é criada ativa e passa a contar no limite de lojas ativas do plano. Apenas código e nome são obrigatórios."
      />
      {atLimit && usage.maxStores !== null ? (
        <Notice tone="warning" title="Limite de lojas do plano atingido">
          O plano {usage.planName} permite até {formatInteger(usage.maxStores)} loja(s) ativa(s) e a empresa já tem{" "}
          {formatInteger(usage.activeStores)}. Desative uma loja ou fale com o suporte para alterar o plano antes de cadastrar
          outra.
        </Notice>
      ) : null}
      <StoreForm regions={regions} organizationTimezone={context.organization.timezone} cancelHref="/lojas" />
    </>
  );
}
