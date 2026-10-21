import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime, formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getImport } from "@/server/imports/queries";
import { IMPORT_FIELDS, IMPORT_KIND_LABELS, IMPORT_STATUS_LABELS, ROW_STATUSES, ROW_STATUS_LABELS, importRowFiltersSchema, type RowStatus } from "@/server/imports/schemas";
import { isDomainError } from "@/server/errors";
import { ImportControls } from "../import-controls";

export const metadata: Metadata = { title: "Prévia da importação" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const ROW_TONES: Record<RowStatus, "positive" | "critical" | "attention" | "brand"> = { ok: "positive", error: "critical", skipped: "attention", applied: "brand", failed: "critical" };

export default async function ImportDetailPage({ params, searchParams }: { params: Promise<{ importId: string }>; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "imports.manage")) return <AccessDenied />;
  const [{ importId }, raw] = await Promise.all([params, searchParams]);
  const filters = importRowFiltersSchema.parse({ status: typeof raw.situacao === "string" ? raw.situacao : undefined, page: typeof raw.page === "string" ? raw.page : undefined });
  let entry: Awaited<ReturnType<typeof getImport>>;
  try { entry = await getImport(context, importId, filters); } catch (error) { if (!isDomainError(error) || error.code !== "limit") throw error; return <Card><CardBody>{error.message}</CardBody></Card>; }
  if (!entry) notFound();
  const tz = context.organization.timezone;
  const values = [
    { label: "Importação", value: `Nº ${entry.number}` },
    { label: "Tipo", value: IMPORT_KIND_LABELS[entry.kind] },
    { label: "Arquivo", value: entry.fileName },
    { label: "Loja", value: entry.storeName ?? "—" },
    { label: "Criada por", value: entry.createdByName ?? "—" },
    { label: "Criada em", value: formatDateTime(entry.createdAt, tz) },
    { label: "Total de linhas", value: formatInteger(entry.totalRows) },
    { label: "Válidas", value: formatInteger(entry.counts.ok) },
    { label: "Com erro", value: formatInteger(entry.counts.error + entry.counts.failed) },
    { label: "Repetidas", value: formatInteger(entry.counts.skipped) },
    { label: "Gravadas", value: formatInteger(entry.counts.applied) },
  ];
  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Importações", href: "/importacoes" }, { label: `Nº ${entry.number}` }]} />
    <PageHeader title={`Importação nº ${entry.number}`} description={IMPORT_KIND_LABELS[entry.kind]} actions={<LinkButton href="/importacoes" variant="secondary">Voltar ao histórico</LinkButton>} />
    <Card className="mt-4"><CardHeader title="Resumo" actions={<Badge tone={entry.status === "done" ? "positive" : entry.status === "previewed" ? "attention" : entry.status === "applying" ? "brand" : "neutral"}>{IMPORT_STATUS_LABELS[entry.status]}</Badge>} /><CardBody><DetailList items={values} />{entry.mapping.length ? <div className="mt-5"><h2 className="text-sm font-semibold">Mapeamento de colunas</h2><ul className="mt-2 grid gap-1 text-sm text-ink-muted sm:grid-cols-2">{entry.mapping.map((item) => <li key={item.field}>{IMPORT_FIELDS[entry.kind].find((field) => field.key === item.field)?.label ?? item.field}: {item.sourceColumn}</li>)}</ul></div> : null}</CardBody></Card>
    {entry.status === "previewed" ? <div className="mt-4"><ImportControls importId={entry.id} validCount={entry.counts.ok} /></div> : null}
    <Card className="mt-4"><CardHeader title="Linhas da importação" description="A prévia mostra somente valores normalizados necessários para revisar as linhas." />
      <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4"><label className="grid gap-1 text-sm">Situação<select className="h-10 rounded-md border border-line-strong bg-surface px-3" name="situacao" defaultValue={filters.status ?? ""}><option value="">Todas</option>{ROW_STATUSES.map((status) => <option key={status} value={status}>{ROW_STATUS_LABELS[status]}</option>)}</select></label><button className="rounded-full border border-line-strong px-4 py-2 text-sm">Filtrar</button></form>
      {entry.rows.rows.length === 0 ? <EmptyState icon={ListChecks} title="Nenhuma linha nesta situação" description="Altere o filtro para consultar outras linhas." /> : <>
        <Table caption="Prévia das linhas importadas"><thead><tr><Th>Linha</Th>{entry.kind === "products" ? <><Th>Produto</Th><Th>Variação</Th><Th>SKU</Th><Th className="text-right">Preço</Th></> : entry.kind === "customers" ? <><Th>Cliente</Th><Th>CPF</Th></> : <><Th>SKU</Th><Th className="text-right">Quantidade</Th></>}<Th>Situação e problemas</Th></tr></thead><tbody>{entry.rows.rows.map((row) => <Tr key={row.line}><Td className="tabular-nums">{row.line}</Td>{entry.kind === "products" ? <><Td>{row.productName ?? "—"}</Td><Td>{row.variantName ?? "—"}</Td><Td>{row.sku ?? "—"}</Td><Td className="text-right tabular-nums">{row.priceCents == null ? "—" : formatCurrencyCents(row.priceCents)}</Td></> : entry.kind === "customers" ? <><Td>{row.customerName ?? "—"}</Td><Td>{row.document ?? "—"}</Td></> : <><Td>{row.sku ?? "—"}</Td><Td className="text-right tabular-nums">{row.quantity ?? "—"}</Td></>}<Td><div className="space-y-1"><Badge tone={ROW_TONES[row.status]}>{ROW_STATUS_LABELS[row.status]}</Badge>{row.messages?.map((message, index) => <p key={`${row.line}-${index}`} className="max-w-md text-xs text-critical">{message}</p>)}</div></Td></Tr>)}</tbody></Table>
        <Pagination page={entry.rows.page} pageCount={entry.rows.pageCount} total={entry.rows.total} basePath={`/importacoes/${entry.id}`} params={{ situacao: filters.status }} />
      </>}
    </Card>
  </>;
}



