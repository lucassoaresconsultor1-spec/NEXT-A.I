import type { Metadata } from "next";
import { Target as TargetIcon } from "lucide-react";
import Form from "next/form";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Field, Select } from "@/components/ui/form";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { DomainError } from "@/server/errors";
import { targetFiltersSchema, TARGET_SCOPE_LABELS, todayIn } from "@/server/targets/schemas";
import { listTargets } from "@/server/targets/service";
import { targetProgress } from "@/server/targets/progress";
import { listSalespeople } from "@/server/salespeople/service";
import { salespeopleFiltersSchema } from "@/server/salespeople/schemas";
import { listRegionOptions } from "@/server/regions/service";
import { listStores } from "@/server/stores/service";
import { storeFiltersSchema } from "@/server/stores/schemas";

export const metadata: Metadata = { title: "Metas de venda" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

async function allPages<T>(fetchPage: (page: number) => Promise<{ rows: T[]; pageCount: number }>) {
  const first = await fetchPage(1);
  if (first.pageCount < 2) return first.rows;
  const rest = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...first.rows, ...rest.flatMap((result) => result.rows)];
}

export default async function TargetsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "targets.read")) return <AccessDenied />;
  const raw = await searchParams;
  const currentMonth = todayIn(context.organization.timezone).slice(0, 7);
  const parsedFilters = targetFiltersSchema.safeParse({ month: one(raw.mes) ?? currentMonth, scope: one(raw.escopo), storeId: one(raw.loja) });
  const filters = parsedFilters.success ? parsedFilters.data : { month: currentMonth };
  let planUnavailable = false;
  let progressPermissionMissing = false;
  let rows: Awaited<ReturnType<typeof targetProgress>> | Awaited<ReturnType<typeof listTargets>>;
  try {
    rows = await targetProgress(context, filters);
  } catch (error) {
    if (!(error instanceof DomainError) || (error.code !== "limit" && error.code !== "forbidden")) throw error;
    planUnavailable = error.code === "limit";
    progressPermissionMissing = error.code === "forbidden";
    rows = await listTargets(context, filters);
  }
  const [stores, regions, salespeople] = await Promise.all([
    can(context, "stores.read") ? allPages((page) => listStores(context, storeFiltersSchema.parse({ page }))) : Promise.resolve([]),
    can(context, "regions.read") ? listRegionOptions(context) : Promise.resolve([]),
    can(context, "members.read") ? allPages((page) => listSalespeople(context, salespeopleFiltersSchema.parse({ page }))) : Promise.resolve([]),
  ]);
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const regionNames = new Map(regions.map((region) => [region.id, region.name]));
  const peopleNames = new Map(salespeople.map((person) => [person.id, person.nickname || person.name]));
  const goalName = (row: (typeof rows)[number]) => row.scope === "organization" ? "Empresa" : row.scope === "region" ? regionNames.get(row.regionId ?? "") ?? "Região" : row.scope === "store" ? storeNames.get(row.storeId ?? "") ?? "Loja do escopo" : `${peopleNames.get(row.salespersonId ?? "") ?? "Vendedor"} · ${storeNames.get(row.storeId ?? "") ?? "Loja do escopo"}`;
  const filtered = Boolean(filters.scope || filters.storeId);
  const storeOptions = stores.map((store) => ({ id: store.id, name: store.name }));
  const canCreate = can(context, "targets.manage");

  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Metas de venda" }]} />
    <PageHeader title="Metas de venda" description="Acompanhe realizado e projeção conforme os serviços de metas e vendas." actions={canCreate ? <LinkButton href="/metas/nova">Nova meta</LinkButton> : undefined} />
    {planUnavailable ? <Notice tone="warning" title="O progresso das metas depende do recurso de vendas estar disponível no plano." /> : null}
    {progressPermissionMissing ? <Notice tone="info" title="Seu perfil não permite consultar os dados de progresso das metas." /> : null}
    <Card>
      <CardBody>
        <Form action="/metas" className="flex flex-wrap items-end gap-3">
          <Field label="Mês">{(props) => <input {...props} type="month" name="mes" defaultValue={filters.month} className="block h-10 rounded-md border border-line-strong bg-surface px-3 text-sm" />}</Field>
          <Field label="Escopo">{(props) => <Select {...props} name="escopo" defaultValue={filters.scope ?? ""}><option value="">Todos</option>{Object.entries(TARGET_SCOPE_LABELS).map(([scope, label]) => <option key={scope} value={scope}>{label}</option>)}</Select>}</Field>
          {can(context, "stores.read") ? <Field label="Loja">{(props) => <Select {...props} name="loja" defaultValue={filters.storeId ?? ""}><option value="">Todas</option>{storeOptions.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}</Field> : null}
          <button type="submit" className="h-10 rounded-full border border-line-strong px-4 text-sm font-medium hover:bg-canvas">Filtrar</button>
        </Form>
      </CardBody>
      {rows.length === 0 ? <EmptyState icon={TargetIcon} title={filtered ? "Nenhuma meta encontrada para este período." : "Nenhuma meta cadastrada para este mês."} description={filtered ? "Ajuste os filtros para consultar outras metas." : "Quando houver metas para o mês, elas aparecerão aqui."} /> : <>
        <Table caption="Metas de venda do período"><thead><tr><Th>Escopo</Th><Th>Meta</Th><Th>Realizado</Th><Th>Atingimento</Th><Th>Projeção para o mês</Th><Th>Versão</Th><Th><span className="sr-only">Histórico</span></Th></tr></thead>
          <tbody>{rows.map((row) => {
            const progress = "achievedCents" in row ? row : null;
            return <Tr key={row.id}>
              <Td><span className="font-medium">{goalName(row)}</span><span className="block text-xs text-ink-muted">{TARGET_SCOPE_LABELS[row.scope]}</span></Td>
              <Td className="font-medium tabular-nums">{formatCurrencyCents(row.amountCents)}</Td>
              <Td className="tabular-nums">{progress ? formatCurrencyCents(progress.achievedCents) : "—"}</Td>
              <Td>{progress ? <Badge tone={Number(progress.percent) >= 100 ? "positive" : "brand"}>{progress.percent.replace(".", ",")}%</Badge> : "—"}</Td>
              <Td className="tabular-nums">{progress ? formatCurrencyCents(progress.projectionCents) : "—"}</Td>
              <Td>v{row.version}</Td><Td><LinkButton href={`/metas/${row.id}/historico`} variant="ghost" size="sm">Ver histórico</LinkButton></Td>
            </Tr>;
          })}</tbody>
        </Table>
      </>}
    </Card>
  </>;
}
