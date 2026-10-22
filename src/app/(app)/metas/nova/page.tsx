import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Notice } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listSalespeople } from "@/server/salespeople/service";
import { salespeopleFiltersSchema } from "@/server/salespeople/schemas";
import { listRegionOptions } from "@/server/regions/service";
import { listStores } from "@/server/stores/service";
import { storeFiltersSchema } from "@/server/stores/schemas";
import { todayIn, type TargetScope } from "@/server/targets/schemas";
import { TargetForm } from "../target-form";

export const metadata: Metadata = { title: "Nova meta" };

async function allPages<T>(fetchPage: (page: number) => Promise<{ rows: T[]; pageCount: number }>) {
  const first = await fetchPage(1);
  if (first.pageCount < 2) return first.rows;
  const rest = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...first.rows, ...rest.flatMap((result) => result.rows)];
}

export default async function NewTargetPage() {
  const context = await requireTenantContext();
  if (!can(context, "targets.read") || !can(context, "targets.manage")) return <AccessDenied />;
  const [stores, regions, people] = await Promise.all([
    can(context, "stores.read") ? allPages((page) => listStores(context, storeFiltersSchema.parse({ page }))) : Promise.resolve([]),
    can(context, "regions.read") ? listRegionOptions(context) : Promise.resolve([]),
    can(context, "members.read") ? allPages((page) => listSalespeople(context, salespeopleFiltersSchema.parse({ status: "active", page }))) : Promise.resolve([]),
  ]);
  const scopes: TargetScope[] = [
    ...(context.storeScope.all ? ["organization" as const] : []),
    ...(regions.length ? ["region" as const] : []),
    ...(stores.length ? ["store" as const] : []),
    ...(stores.length && people.length ? ["salesperson" as const] : []),
  ];
  const month = todayIn(context.organization.timezone).slice(0, 7);
  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Metas de venda", href: "/metas" }, { label: "Nova meta" }]} />
    <PageHeader title="Nova meta" description="Salvar uma meta cria uma versão. O motivo é obrigatório para alterar uma meta já cadastrada." />
    {scopes.length ? <TargetForm scopes={scopes} regions={regions} stores={stores.map(({ id, name }) => ({ id, name }))} people={people} month={month} /> : <Notice tone="warning" title="Seu perfil não tem opções de escopo disponíveis para definir metas." />}
  </>;
}
