import type { Metadata } from "next";
import { List } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr, Pagination } from "@/components/ui/table";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listRuns } from "@/server/reports/service";
import { DownloadReportButton } from "./download-button";
import { REPORT_KIND_LABELS } from "@/server/reports/catalog";

export const metadata: Metadata = { title: "Relatórios" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "reports.read")) return <AccessDenied />;
  const raw = await searchParams;
  const page = Number(one(raw.pagina) ?? "1");
  const result = await listRuns(context, { page });

  return (
    <div>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Relatórios" }]} />
      <PageHeader title="Relatórios" description="Gere e consulte relatórios exportáveis em CSV." actions={<LinkButton href="/relatorios/novo">Novo relatório</LinkButton>} />
      <Card>
        <CardBody>
          {result.rows.length === 0 ? (
            <EmptyState icon={List} title="Nenhum relatório gerado." description="Gere seu primeiro relatório para exportar dados." action={<LinkButton href="/relatorios/novo">Novo relatório</LinkButton>} />
          ) : (
            <div>
              <Table caption="Relatórios gerados"><thead><tr><Th>Tipo</Th><Th>Período</Th><Th>Linha(s)</Th><Th>Situação</Th><Th>Gerado em</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
                <tbody>{result.rows.map((row) => <Tr key={row.id}>
                  <Td>{REPORT_KIND_LABELS[row.kind as keyof typeof REPORT_KIND_LABELS] ?? row.kind}</Td>
                  <Td>{row.from} a {row.to}</Td>
                  <Td className="tabular-nums">{row.rowCount}</Td>
                  <Td><Badge tone={row.status === "done" ? "positive" : row.status === "failed" ? "critical" : "attention"}>{row.status === "done" ? "Pronto" : row.status === "failed" ? "Falhou" : "Pendente"}</Badge></Td>
                  <Td className="font-mono text-xs text-ink-soft">{new Date(row.createdAt).toLocaleString("pt-BR")}</Td>
                  <Td><DownloadReportButton runId={row.id} status={row.status} /></Td>
                </Tr>)}</tbody>
              </Table>
              <Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/relatorios" params={{ pagina: undefined }} />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
