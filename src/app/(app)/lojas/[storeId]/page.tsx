import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { formatCep, formatCnpj, formatPhone } from "@/lib/documents";
import { formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getStore } from "@/server/stores/service";
import { StoreStatusDialog } from "../store-status-dialog";
import { cityState, inheritedTimezoneLabel, STORE_STATUS_LABELS, storeStatusTone, timezoneLabel } from "../store-labels";

export const metadata: Metadata = { title: "Loja" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function DetailCard({ title, description, items }: { title: string; description?: string; items: { label: string; value: ReactNode }[] }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <DetailList items={items} />
      </CardBody>
    </Card>
  );
}

export default async function StoreDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: SearchParams;
}) {
  const context = await requireTenantContext();
  if (!can(context, "stores.read")) return <AccessDenied />;
  const { storeId } = await params;
  const store = await getStore(context, storeId);
  if (!store) notFound();
  const query = await searchParams;
  // getStore only answers stores in scope, so the permission is the remaining check.
  const canManage = can(context, "stores.manage");
  const tz = context.organization.timezone;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Lojas", href: "/lojas" }, { label: store.name }]} />
      <PageHeader
        title={store.name}
        description={`Código ${store.code}${store.regionName ? ` · Região ${store.regionName}` : ""}`}
        actions={
          canManage ? (
            <>
              <LinkButton href={`/lojas/${store.id}/editar`} variant="secondary">
                <Pencil className="size-4" aria-hidden /> Editar
              </LinkButton>
              <StoreStatusDialog store={{ id: store.id, name: store.name, status: store.status }} />
            </>
          ) : undefined
        }
      />
      {query.criada ? <Notice tone="success" title="Loja cadastrada." /> : null}
      {query.atualizada ? <Notice tone="success" title="Alterações salvas." /> : null}
      {store.status === "inactive" ? (
        <Notice tone="warning" title="Loja inativa">
          Ela não aparece nos seletores e não conta no limite de lojas ativas do plano. O cadastro, a equipe vinculada e o
          histórico continuam preservados.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <DetailCard
          title="Identificação"
          items={[
            { label: "Código", value: <span className="font-mono">{store.code}</span> },
            { label: "Nome", value: store.name },
            { label: "CNPJ", value: store.document ? formatCnpj(store.document) : null },
            { label: "Situação", value: <Badge tone={storeStatusTone(store.status)}>{STORE_STATUS_LABELS[store.status]}</Badge> },
          ]}
        />
        <DetailCard
          title="Contato"
          items={[
            { label: "Telefone", value: store.phone ? formatPhone(store.phone) : null },
            { label: "E-mail", value: store.email },
          ]}
        />
        <DetailCard
          title="Endereço"
          items={[
            { label: "CEP", value: store.postalCode ? formatCep(store.postalCode) : null },
            { label: "Logradouro", value: store.street },
            { label: "Número", value: store.number },
            { label: "Complemento", value: store.complement },
            { label: "Bairro", value: store.district },
            { label: "Cidade/UF", value: cityState(store.city, store.state) },
          ]}
        />
        <DetailCard
          title="Operação"
          description={`Datas exibidas no fuso da empresa: ${timezoneLabel(tz)}.`}
          items={[
            { label: "Região", value: store.regionName ?? "Sem região" },
            { label: "Fuso horário", value: store.timezone ? timezoneLabel(store.timezone) : inheritedTimezoneLabel(tz) },
            { label: "Cadastrada em", value: formatDateTime(store.createdAt, tz) },
            { label: "Atualizada em", value: formatDateTime(store.updatedAt, tz) },
          ]}
        />
      </div>
    </>
  );
}
