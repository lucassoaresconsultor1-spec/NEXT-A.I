import { Award } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { ReferenceView } from "@/components/catalog/reference-view";
import type { ReferenceCopy } from "@/components/catalog/reference-dialogs";
import { parseStatusParam } from "@/components/catalog/status-param";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listReferences, REFERENCE_LIST_LIMIT } from "@/server/catalog/references";
import { saveBrandAction, setBrandActiveAction } from "./actions";

export const metadata: Metadata = { title: "Marcas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const COPY: ReferenceCopy = {
  title: "Marcas",
  description: "Marcas dos produtos vendidos pela empresa, compartilhadas por todas as lojas.",
  singular: "marca",
  plural: "marcas",
  newButton: "Nova marca",
  nameHint: "Entre 2 e 80 caracteres. Não pode repetir outra marca.",
  filterLabel: "Filtrar marcas",
  filterOptions: { all: "Todas", active: "Ativas", inactive: "Inativas" },
  activeBadge: "Ativa",
  inactiveBadge: "Inativa",
  caption: "Marcas cadastradas",
  emptyTitle: "Nenhuma marca cadastrada",
  emptyDescriptionManage: "Cadastre as marcas dos produtos da empresa.",
  emptyDescriptionReadOnly: "As marcas aparecerão aqui quando um administrador da empresa cadastrá-las.",
  emptyFilteredActive: "Nenhuma marca ativa",
  emptyFilteredInactive: "Nenhuma marca inativa",
};

export default async function BrandsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const params = await searchParams;
  const status = parseStatusParam(params.situacao);
  const rows = await listReferences(context, "brand", { status });
  const canManage = can(context, "catalog.manage") && context.storeScope.all;

  return (
    <ReferenceView
      basePath="/marcas"
      icon={Award}
      copy={COPY}
      rows={rows}
      status={status}
      canManage={canManage}
      limit={REFERENCE_LIST_LIMIT}
      saveAction={saveBrandAction}
      statusAction={setBrandActiveAction}
    />
  );
}
