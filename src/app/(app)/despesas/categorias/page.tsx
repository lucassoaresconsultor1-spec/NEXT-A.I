import type { Metadata } from "next";
import { List } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCategories } from "@/server/expenses/service";
import { CategoryRowActions } from "../category-actions";

export const metadata: Metadata = { title: "Categorias de despesa" };

export default async function CategoriesPage() {
  const context = await requireTenantContext();
  if (!can(context, "expenses.read")) return <AccessDenied />;
  const canManage = can(context, "expenses.manage");
  const categories = await listCategories(context);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Despesas", href: "/despesas" }, { label: "Categorias" }]} />
      <PageHeader title="Categorias de despesa" description="Categorias usadas nas despesas das lojas." actions={canManage ? <LinkButton href="/despesas/categorias/nova">Nova categoria</LinkButton> : undefined} />
      <Card>
        <CardBody>
          {categories.length === 0 ? (
            <EmptyState icon={List} title="Nenhuma categoria cadastrada." description="Crie a primeira categoria para classificar despesas." action={canManage ? <LinkButton href="/despesas/categorias/nova">Nova categoria</LinkButton> : undefined} />
          ) : (
            <Table caption="Categorias de despesa"><thead><tr><Th>Nome</Th><Th>Situação</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
              <tbody>{categories.map((category) => <Tr key={category.id}>
                <Td>{category.name}</Td>
                <Td><Badge tone={category.isActive ? "positive" : "neutral"}>{category.isActive ? "Ativa" : "Inativa"}</Badge></Td>
                <Td><CategoryRowActions categoryId={category.id} isActive={category.isActive} /></Td>
              </Tr>)}</tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
