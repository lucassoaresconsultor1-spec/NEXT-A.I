import { History, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { AUDIT_ENTITY_LABELS, auditActionLabel } from "@/server/audit/labels";
import { auditFiltersSchema, listAuditLogs } from "@/server/audit/service";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { AuditDetails } from "./audit-details";
import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = { title: "Auditoria" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

// Written by the platform administration inside the organization.
const PLATFORM_ACTIONS: ReadonlySet<string> = new Set(["organization.plan_changed", "organization.status_changed"]);

const ENTITY_OPTIONS = Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => ({ value, label }));

function firstPageHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/auditoria?${query}` : "/auditoria";
}

function Responsible({ action, actorName }: { action: string; actorName: string | null }) {
  const platform = PLATFORM_ACTIONS.has(action);
  if (!actorName) return <span className="text-ink-soft">{platform ? "Plataforma" : "Sistema"}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>{actorName}</span>
      {platform ? <Badge tone="brand">Plataforma</Badge> : null}
    </span>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "audit.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = auditFiltersSchema.parse({
    entityType: single(raw.entidade),
    from: single(raw.de),
    to: single(raw.ate),
    page: single(raw.page),
  });
  const result = await listAuditLogs(context, filters);
  const timeZone = context.organization.timezone;
  const params = { entidade: filters.entityType, de: filters.from, ate: filters.to };
  const filtered = Boolean(filters.entityType || filters.from || filters.to);
  const invertedRange = Boolean(filters.from && filters.to && filters.from > filters.to);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Auditoria" }]} />
      <PageHeader
        title="Auditoria"
        description="Trilha imutável das alterações de estrutura, equipe, perfis, empresa e plano, com data, responsável e campos alterados."
      />
      {context.storeScope.all ? null : (
        <Notice tone="info" title="Você vê apenas eventos ligados às lojas do seu escopo.">
          Eventos da empresa como um todo (dados da empresa, plano, regiões, perfis) aparecem somente para quem tem acesso a
          todas as lojas.
        </Notice>
      )}
      <Card>
        <AuditFilters key={JSON.stringify(params)} values={params} entities={ENTITY_OPTIONS} />
        {invertedRange ? (
          <div className="px-4 pt-4">
            <Notice tone="warning" title="A data inicial é posterior à data final." />
          </div>
        ) : null}
        {result.rows.length === 0 ? (
          result.total === 0 && !filtered ? (
            <EmptyState
              icon={History}
              title="Nenhum evento registrado"
              description="As alterações feitas na empresa aparecerão aqui."
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Nenhum evento encontrado"
              description={result.total > 0 ? "Esta página não tem resultados." : "Ajuste a entidade ou o período para ver outros eventos."}
              action={
                <LinkButton href={result.total > 0 ? firstPageHref(params) : "/auditoria"} variant="secondary">
                  {result.total > 0 ? "Voltar à primeira página" : "Limpar filtros"}
                </LinkButton>
              }
            />
          )
        ) : (
          <>
            <Table caption="Eventos de auditoria, do mais recente para o mais antigo">
              <thead>
                <tr>
                  <Th>Data e hora</Th>
                  <Th>Ação</Th>
                  <Th>Entidade</Th>
                  <Th>Responsável</Th>
                  <Th>Detalhes</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap tabular-nums text-ink-soft">
                      <time dateTime={entry.createdAt.toISOString()}>{formatDateTime(entry.createdAt, timeZone)}</time>
                    </Td>
                    <Td className="font-medium">{auditActionLabel(entry.action)}</Td>
                    <Td className="text-ink-soft">{AUDIT_ENTITY_LABELS[entry.entityType] ?? entry.entityType}</Td>
                    <Td>
                      <Responsible action={entry.action} actorName={entry.actorName} />
                    </Td>
                    <Td className="max-w-md">
                      <AuditDetails changes={entry.changes} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/auditoria" params={params} />
          </>
        )}
      </Card>
    </>
  );
}
