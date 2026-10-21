import { Tags } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { ReferenceView } from "@/components/catalog/reference-view";
import type { ReferenceCopy } from "@/components/catalog/reference-dialogs";
import { parseStatusParam } from "@/components/catalog/status-param";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listReferences, REFERENCE_LIST_LIMIT } from "@/server/catalog/references";
import { saveCategoryAction, setCategoryActiveAction } from "./actions";

export const metadata: Metadata = { title: "Categorias" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const COPY: ReferenceCopy = {
  title: "Categorias",
  description: "Agrupe os produtos da empresa por categoria. O cadastro é compartilhado por todas as lojas.",
  singular: "categoria",
  plural: "categorias",
  newButton: "Nova categoria",
  nameHint: "Entre 2 e 80 caracteres. Não pode repetir outra categoria.",
  filterLabel: "Filtrar categorias",
  filterOptions: { all: "Todas", active: "Ativas", inactive: "Inativas" },
  activeBadge: "Ativa",
  inactiveBadge: "Inativa",
  caption: "Categorias cadastradas",
  emptyTitle: "Nenhuma categoria cadastrada",
  emptyDescriptionManage: "Cadastre categorias para organizar os produtos da empresa.",
  emptyDescriptionReadOnly: "As categorias aparecerão aqui quando um administrador da empresa cadastrá-las.",
  emptyFilteredActive: "Nenhuma categoria ativa",
  emptyFilteredInactive: "Nenhuma categoria inativa",
};

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const params = await searchParams;
  const status = parseStatusParam(params.situacao);
  const rows = await listReferences(context, "category", { status });
  const canManage = can(context, "catalog.manage") && context.storeScope.all;

  return (
    <ReferenceView
      basePath="/categorias"
      icon={Tags}
      copy={COPY}
      rows={rows}
      status={status}
      canManage={canManage}
      limit={REFERENCE_LIST_LIMIT}
      saveAction={saveCategoryAction}
      statusAction={setCategoryActiveAction}
    />
  );
}
