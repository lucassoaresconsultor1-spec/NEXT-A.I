import { FileUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime, formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { IMPORT_FIELDS, IMPORT_KIND_LABELS, IMPORT_STATUS_LABELS, importFiltersSchema, type ImportKind, type ImportStatus } from "@/server/imports/schemas";
import { listImports } from "@/server/imports/queries";
import { listStoreOptions } from "@/server/stores/options";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importações" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const TONES: Record<ImportStatus, "neutral" | "positive" | "attention" | "brand"> = { previewed: "attention", applying: "brand", done: "positive", discarded: "neutral" };

export default async function ImportsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "imports.manage")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = importFiltersSchema.parse({ kind: typeof raw.tipo === "string" ? raw.tipo : undefined, status: typeof raw.situacao === "string" ? raw.situacao : undefined, page: typeof raw.page === "string" ? raw.page : undefined });
  const [result, stores] = await Promise.all([listImports(context, filters), listStoreOptions(context)]);
  const allowedKinds: ImportKind[] = [
    ...(can(context, "catalog.manage") && context.storeScope.all ? ["products" as const] : []),
    ...(can(context, "customers.manage") ? ["customers" as const] : []),
    ...(can(context, "inventory.manage") && stores.length > 0 ? ["opening_stock" as const] : []),
  ];
  const tz = context.organization.timezone;
  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Importações" }]} />
    <PageHeader title="Importações" description="Prepare prévias CSV, revise as linhas e confirme os dados válidos." />
    <Card className="mt-4"><CardHeader title="Nova importação" description="O arquivo é processado no servidor; nenhum dado é gravado até a confirmação." /><CardBody><ImportWizard allowedKinds={allowedKinds} fields={IMPORT_FIELDS} kindLabels={IMPORT_KIND_LABELS} stores={stores.map(({ id, name }) => ({ id, name }))} /></CardBody></Card>
    <Card className="mt-5"><CardHeader title="Histórico de importações" />
      <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <label className="grid gap-1 text-sm">Tipo<select className="h-10 rounded-md border border-line-strong bg-surface px-3" name="tipo" defaultValue={filters.kind ?? ""}><option value="">Todos</option>{Object.entries(IMPORT_KIND_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Situação<select className="h-10 rounded-md border border-line-strong bg-surface px-3" name="situacao" defaultValue={filters.status ?? ""}><option value="">Todas</option>{Object.entries(IMPORT_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <button className="rounded-full border border-line-strong px-4 py-2 text-sm">Filtrar</button>
      </form>
      {result.rows.length === 0 ? <EmptyState icon={FileUp} title="Nenhuma importação" description="As prévias e os resultados das importações aparecerão aqui." /> : <>
        <Table caption="Histórico de importações"><thead><tr><Th>Nº</Th><Th>Tipo</Th><Th>Arquivo</Th><Th>Linhas</Th><Th>Situação</Th><Th>Criada por</Th><Th>Data</Th></tr></thead><tbody>{result.rows.map((row) => <Tr key={row.id}><Td className="font-medium tabular-nums"><Link href={`/importacoes/${row.id}`} className="text-brand-strong hover:underline">{row.number}</Link></Td><Td>{IMPORT_KIND_LABELS[row.kind]}</Td><Td className="max-w-56 truncate" title={row.fileName}>{row.fileName}</Td><Td className="tabular-nums">{formatInteger(row.totalRows)}</Td><Td><Badge tone={TONES[row.status]}>{IMPORT_STATUS_LABELS[row.status]}</Badge></Td><Td>{row.createdByName ?? "—"}</Td><Td className="whitespace-nowrap">{formatDateTime(row.createdAt, tz)}</Td></Tr>)}</tbody></Table>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/importacoes" params={{ tipo: filters.kind, situacao: filters.status }} />
      </>}
    </Card>
  </>;
}



