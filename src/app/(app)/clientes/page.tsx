import { Contact } from "lucide-react";
import type { Metadata } from "next";
import { StatusFilter } from "@/components/catalog/status-filter";
import { parseStatusParam, statusToParam } from "@/components/catalog/status-param";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCpf, formatPhone } from "@/lib/documents";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { customerFiltersSchema } from "@/server/customers/schemas";
import { listCustomers } from "@/server/customers/service";
import { saveCustomerAction, setCustomerActiveAction } from "./actions";
import { CustomerFormDialog, CustomerStatusDialog, type CustomerDialogRow } from "./customer-dialogs";

export const metadata: Metadata = { title: "Clientes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "customers.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = customerFiltersSchema.parse({ q: single(raw.q), status: parseStatusParam(raw.situacao), page: single(raw.page) });
  const result = await listCustomers(context, filters);
  // Customers belong to the organization; the service does not require access to every store.
  const canManage = can(context, "customers.manage");

  const filterValue = statusToParam(filters.status);
  const queryValue = filters.q ?? "";
  const hasFilter = Boolean(filters.status || filters.q);
  // Only the fields the dialogs need reach the client; the CPF is already masked by the service when required.
  const rows: CustomerDialogRow[] = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    document: row.document,
    documentMasked: row.documentMasked,
    email: row.email,
    phone: row.phone,
    marketingConsent: row.marketingConsent,
    isActive: row.isActive,
  }));

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Clientes" }]} />
      <PageHeader
        title="Clientes"
        description="Clientes da empresa, compartilhados por todas as lojas. Use o mínimo de dados necessário."
        actions={canManage ? <CustomerFormDialog saveAction={saveCustomerAction} /> : undefined}
      />
      <Card>
        {rows.length > 0 || hasFilter ? (
          <>
            <StatusFilter
              key={`${filterValue}|${queryValue}`}
              basePath="/clientes"
              value={filterValue}
              query={queryValue}
              label="Filtrar clientes"
              options={{ all: "Todos", active: "Ativos", inactive: "Inativos" }}
            />
            <p className="px-4 pt-3 text-xs text-ink-muted">Também é possível buscar pelo CPF, e-mail ou telefone completos.</p>
          </>
        ) : null}
        {rows.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={Contact}
              title="Nenhum cliente encontrado"
              description="Altere a busca ou o filtro de situação."
              action={
                <LinkButton href="/clientes" variant="secondary">
                  Ver todos
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Contact}
              title="Nenhum cliente cadastrado"
              description={canManage ? "Cadastre clientes para identificá-los nas vendas." : "Os clientes aparecerão aqui quando forem cadastrados."}
              action={canManage ? <CustomerFormDialog saveAction={saveCustomerAction} /> : undefined}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Clientes cadastrados">
                <thead>
                  <tr>
                    <Th>Nome</Th>
                    <Th>CPF</Th>
                    <Th>E-mail</Th>
                    <Th>Telefone</Th>
                    <Th>Contato autorizado</Th>
                    <Th>Situação</Th>
                    {canManage ? <Th className="text-right">Ações</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Tr key={row.id}>
                      <Td className="font-medium">{row.name}</Td>
                      <Td className="whitespace-nowrap text-ink-soft tabular-nums">
                        {row.document === null ? "—" : row.documentMasked ? row.document : formatCpf(row.document)}
                      </Td>
                      <Td className="text-ink-soft">{row.email ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-ink-soft">{row.phone ? formatPhone(row.phone) : "—"}</Td>
                      <Td>{row.marketingConsent ? <Badge tone="brand">Sim</Badge> : <span className="text-ink-muted">Não</span>}</Td>
                      <Td>
                        <Badge tone={row.isActive ? "positive" : "neutral"}>{row.isActive ? "Ativo" : "Inativo"}</Badge>
                      </Td>
                      {canManage ? (
                        <Td className="text-right">
                          <div className="flex justify-end gap-1">
                            <CustomerFormDialog saveAction={saveCustomerAction} row={row} />
                            <CustomerStatusDialog statusAction={setCustomerActiveAction} row={row} />
                          </div>
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/clientes"
              params={{ q: filters.q, situacao: filterValue || undefined }}
            />
          </>
        )}
      </Card>
    </>
  );
}
