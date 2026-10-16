import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { DEPARTMENT_LIST_LIMIT, listDepartments, type DepartmentStatus } from "@/server/departments/service";
import { DeleteDepartmentDialog, DepartmentFormDialog, DepartmentStatusDialog } from "./department-dialogs";

export const metadata: Metadata = { title: "Departamentos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// URL values stay in pt-BR (?situacao=ativo|inativo); anything else means "all".
function parseStatus(value: string | undefined): DepartmentStatus | undefined {
  if (value === "ativo") return "active";
  if (value === "inativo") return "inactive";
  return undefined;
}

const STATUS_PARAM: Record<DepartmentStatus, string> = { active: "ativo", inactive: "inativo" };

/** Plain GET form: works without JavaScript and keeps the filter in the URL. */
function StatusFilter({ value }: { value: string }) {
  return (
    <Form
      action="/departamentos"
      role="search"
      aria-label="Filtrar departamentos"
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3"
    >
      <div className="space-y-1.5">
        <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
          Situação
        </label>
        <Select id="filtro-situacao" name="situacao" defaultValue={value} className="w-44">
          <option value="">Todas</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
      {value ? (
        <LinkButton href="/departamentos" variant="ghost">
          Limpar filtro
        </LinkButton>
      ) : null}
    </Form>
  );
}

function ListFooter({ count }: { count: number }) {
  return (
    <p className="px-4 py-3 text-sm text-ink-muted">
      {formatInteger(count)} {count === 1 ? "departamento" : "departamentos"}
      {count >= DEPARTMENT_LIST_LIMIT ? ` · exibindo os primeiros ${formatInteger(DEPARTMENT_LIST_LIMIT)} em ordem alfabética` : ""}
    </p>
  );
}

export default async function DepartmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "departments.read")) return <AccessDenied />;
  const params = await searchParams;
  const status = parseStatus(typeof params.situacao === "string" ? params.situacao : undefined);
  const departments = await listDepartments(context, { status });
  const canManage = can(context, "departments.manage") && context.storeScope.all;
  const filterValue = status ? STATUS_PARAM[status] : "";

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Departamentos" }]} />
      <PageHeader
        title="Departamentos"
        description="Catálogo de setores da empresa, como Eletro, Móveis ou Celulares, compartilhado por todas as lojas."
        actions={canManage ? <DepartmentFormDialog /> : undefined}
      />
      <Card>
        {departments.length > 0 || status ? <StatusFilter key={filterValue} value={filterValue} /> : null}
        {departments.length === 0 ? (
          status ? (
            <EmptyState
              icon={Building2}
              title={status === "active" ? "Nenhum departamento ativo" : "Nenhum departamento inativo"}
              description="Altere o filtro de situação para ver os demais departamentos."
              action={
                <LinkButton href="/departamentos" variant="secondary">
                  Ver todos
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Building2}
              title="Nenhum departamento cadastrado"
              description={
                canManage
                  ? "Cadastre os setores da empresa para organizar a operação das lojas."
                  : "Os departamentos aparecerão aqui quando um administrador da empresa cadastrá-los."
              }
              action={canManage ? <DepartmentFormDialog /> : undefined}
            />
          )
        ) : (
          <>
            <Table caption="Departamentos cadastrados">
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Descrição</Th>
                  <Th>Situação</Th>
                  {canManage ? <Th className="text-right">Ações</Th> : null}
                </tr>
              </thead>
              <tbody>
                {departments.map((department) => (
                  <Tr key={department.id}>
                    <Td className="font-medium">{department.name}</Td>
                    <Td className="text-ink-soft">{department.description ?? "—"}</Td>
                    <Td>
                      <Badge tone={department.isActive ? "positive" : "neutral"}>
                        {department.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <DepartmentFormDialog department={department} />
                          <DepartmentStatusDialog department={department} />
                          <DeleteDepartmentDialog department={department} />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <ListFooter count={departments.length} />
          </>
        )}
      </Card>
    </>
  );
}
