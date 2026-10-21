import { Truck } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCnpj, formatPhone } from "@/lib/documents";
import { StatusFilter } from "@/components/catalog/status-filter";
import { parseStatusParam, statusToParam } from "@/components/catalog/status-param";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listSuppliers } from "@/server/catalog/references";
import { supplierFiltersSchema } from "@/server/catalog/schemas";
import { saveSupplierAction, setSupplierActiveAction } from "./actions";
import { SupplierFormDialog, SupplierStatusDialog } from "./supplier-dialogs";

export const metadata: Metadata = { title: "Fornecedores" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const raw = await searchParams;
  const status = parseStatusParam(raw.situacao);
  const q = typeof raw.q === "string" ? raw.q : undefined;
  const filters = supplierFiltersSchema.parse({
    q,
    status,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const result = await listSuppliers(context, filters);
  const canManage = can(context, "catalog.manage") && context.storeScope.all;

  const filterValue = statusToParam(filters.status);
  const queryValue = filters.q ?? "";
  const hasFilter = Boolean(filters.status || filters.q);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Fornecedores" }]} />
      <PageHeader
        title="Fornecedores"
        description="Fornecedores dos produtos da empresa, compartilhados por todas as lojas."
        actions={canManage ? <SupplierFormDialog saveAction={saveSupplierAction} /> : undefined}
      />
      <Card>
        {result.rows.length > 0 || hasFilter ? (
          <StatusFilter
            key={`${filterValue}|${queryValue}`}
            basePath="/fornecedores"
            value={filterValue}
            query={queryValue}
            label="Filtrar fornecedores"
            options={{ all: "Todos", active: "Ativos", inactive: "Inativos" }}
          />
        ) : null}
        {result.rows.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={Truck}
              title="Nenhum fornecedor encontrado"
              description="Altere a busca ou o filtro de situação para ver os demais fornecedores."
              action={
                <LinkButton href="/fornecedores" variant="secondary">
                  Ver todos
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="Nenhum fornecedor cadastrado"
              description={
                canManage
                  ? "Cadastre os fornecedores para associá-los aos produtos."
                  : "Os fornecedores aparecerão aqui quando um administrador da empresa os cadastrar."
              }
              action={canManage ? <SupplierFormDialog saveAction={saveSupplierAction} /> : undefined}
            />
          )
        ) : (
          <>
            <Table caption="Fornecedores cadastrados">
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>CNPJ</Th>
                  <Th>E-mail</Th>
                  <Th>Telefone</Th>
                  <Th>Situação</Th>
                  {canManage ? <Th className="text-right">Ações</Th> : null}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((supplier) => (
                  <Tr key={supplier.id}>
                    <Td className="font-medium">{supplier.name}</Td>
                    <Td className="text-ink-soft">
                      {supplier.document ? formatCnpj(supplier.document) : "—"}
                    </Td>
                    <Td className="text-ink-soft">{supplier.email ?? "—"}</Td>
                    <Td className="text-ink-soft">
                      {supplier.phone ? formatPhone(supplier.phone) : "—"}
                    </Td>
                    <Td>
                      <Badge tone={supplier.isActive ? "positive" : "neutral"}>
                        {supplier.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <SupplierFormDialog saveAction={saveSupplierAction} row={supplier} />
                          <SupplierStatusDialog
                            statusAction={setSupplierActiveAction}
                            row={supplier}
                          />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/fornecedores"
              params={{ q: filters.q, situacao: statusToParam(filters.status) || undefined }}
            />
          </>
        )}
      </Card>
    </>
  );
}
