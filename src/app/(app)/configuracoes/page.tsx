import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getOrganizationProfile } from "@/server/organizations/service";
import { CompanyCard } from "./company-card";
import { PlanCard } from "./plan-card";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const context = await requireTenantContext();
  if (!can(context, "organization.settings.read")) return <AccessDenied />;
  const profile = await getOrganizationProfile(context);
  if (!profile) notFound();
  const canManage = can(context, "organization.settings.manage") && context.storeScope.all;
  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Configurações" }]} />
      <PageHeader title="Configurações" description="Dados cadastrais da empresa, plano contratado e uso dos limites." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <CompanyCard profile={profile} canManage={canManage} />
        <PlanCard plan={profile.plan} usage={profile.usage} />
      </div>
    </>
  );
}
