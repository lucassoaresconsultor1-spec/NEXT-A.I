import { Building2, Plus, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCnpj } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { listOrganizations, listPlans, platformFiltersSchema, requirePlatformAdmin } from "@/server/platform/service";
import { PlanDialog } from "./plan-dialog";
import { PlatformFilters } from "./platform-filters";
import { StatusDialog } from "./status-dialog";

export const metadata: Metadata = { title: "Administração da plataforma" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function firstPageHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/plataforma?${query}` : "/plataforma";
}

export default async function PlatformPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requirePlatformAdmin();
  const raw = await searchParams;
  const filters = platformFiltersSchema.parse({ q: single(raw.q), status: single(raw.status), page: single(raw.page) });
  const [result, plans] = await Promise.all([listOrganizations(admin.userId, filters), listPlans(admin.userId)]);
  const params = { q: filters.q, status: filters.status };
  const filtered = Boolean(filters.q || filters.status);

  return (
    <>
      <Breadcrumbs items={[{ label: "Plataforma" }, { label: "Empresas clientes" }]} />
      <PageHeader
        title="Empresas clientes"
        description="Cadastre empresas com o acesso do dono, altere o plano e a situação. A administração da plataforma não acessa lojas, equipe nem dados comerciais dos clientes."
        actions={
          <LinkButton href="/plataforma/nova-empresa">
            <Plus className="size-4" aria-hidden /> Nova empresa
          </LinkButton>
        }
      />
      {raw.criada === "1" ? (
        <Notice tone="success" title="Empresa cadastrada.">
          Envie ao dono o e-mail de acesso e a senha provisória por um canal seguro. A troca da senha é exigida no primeiro acesso.
        </Notice>
      ) : null}
      <Card>
        <PlatformFilters key={JSON.stringify(params)} values={params} />
        {result.rows.length === 0 ? (
          result.total === 0 && !filtered ? (
            <EmptyState
              icon={Building2}
              title="Nenhuma empresa cadastrada"
              description="Cadastre a primeira empresa em Nova empresa. Empresas criadas pelo cadastro público também aparecem aqui."
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Nenhuma empresa encontrada"
              description={result.total > 0 ? "Esta página não tem resultados." : "Ajuste a busca ou a situação para ver outras empresas."}
              action={
                <LinkButton href={result.total > 0 ? firstPageHref(params) : "/plataforma"} variant="secondary">
                  {result.total > 0 ? "Voltar à primeira página" : "Limpar filtros"}
                </LinkButton>
              }
            />
          )
        ) : (
          <>
            <Table caption="Empresas clientes da plataforma">
              <thead>
                <tr>
                  <Th>Empresa</Th>
                  <Th>CNPJ</Th>
                  <Th>Plano</Th>
                  <Th>Situação</Th>
                  <Th>Criada em</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((organization) => (
                  <Tr key={organization.id}>
                    <Td className="font-medium">{organization.name}</Td>
                    <Td className="whitespace-nowrap font-mono text-xs text-ink-soft">
                      {organization.document ? formatCnpj(organization.document) : "—"}
                    </Td>
                    <Td>{organization.planName}</Td>
                    <Td>
                      {organization.status === "active" ? (
                        <Badge tone="positive">Ativa</Badge>
                      ) : (
                        <Badge tone="critical">Suspensa</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums text-ink-soft">{formatDate(organization.createdAt)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <PlanDialog
                          organization={{ id: organization.id, name: organization.name, planKey: organization.planKey }}
                          plans={plans}
                        />
                        <StatusDialog
                          organization={{ id: organization.id, name: organization.name, status: organization.status }}
                        />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/plataforma" params={params} />
          </>
        )}
      </Card>
    </>
  );
}
