import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/layout";
import { BRAZIL_TIMEZONES } from "@/lib/brazil";
import { formatCnpj } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { CompanyProfileDialog, type ProfileValues } from "./settings-form";

export function CompanyCard({ profile, canManage }: { profile: ProfileValues & { createdAt: Date }; canManage: boolean }) {
  const zone = BRAZIL_TIMEZONES.find((entry) => entry.value === profile.timezone);
  return (
    <Card>
      <CardHeader
        title="Dados da empresa"
        description="Identificação usada em todo o sistema."
        actions={
          canManage ? (
            <CompanyProfileDialog
              profile={{ name: profile.name, legalName: profile.legalName, document: profile.document, timezone: profile.timezone }}
            />
          ) : undefined
        }
      />
      <CardBody>
        <DetailList
          items={[
            { label: "Nome da empresa", value: profile.name },
            { label: "Razão social", value: profile.legalName ?? "—" },
            { label: "CNPJ", value: profile.document ? formatCnpj(profile.document) : "Não informado" },
            { label: "Fuso horário", value: zone?.label ?? profile.timezone },
            { label: "Cliente desde", value: formatDate(profile.createdAt, profile.timezone) },
          ]}
        />
      </CardBody>
    </Card>
  );
}
