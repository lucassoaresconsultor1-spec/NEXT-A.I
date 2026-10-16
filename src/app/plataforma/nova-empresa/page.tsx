import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { DEFAULT_PLAN_KEY } from "@/server/organizations/provisioning";
import { listPlans, requirePlatformAdmin } from "@/server/platform/service";
import { OrganizationForm } from "../organization-form";

export const metadata: Metadata = { title: "Nova empresa" };

export default async function NewOrganizationPage() {
  const admin = await requirePlatformAdmin();
  const plans = await listPlans(admin.userId);
  return (
    <>
      <Breadcrumbs items={[{ label: "Plataforma", href: "/plataforma" }, { label: "Nova empresa" }]} />
      <PageHeader
        title="Nova empresa"
        description="Cadastre a empresa cliente e o acesso do dono. A partir do primeiro acesso, o dono cadastra lojas, equipe e perfis."
      />
      <Card>
        <CardBody>
          <OrganizationForm plans={plans} defaultPlanKey={DEFAULT_PLAN_KEY} />
        </CardBody>
      </Card>
    </>
  );
}
