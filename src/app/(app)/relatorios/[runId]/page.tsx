import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getRunCsv } from "@/server/reports/service";

type SearchParams = Promise<{ runId: string }>;

export const metadata: Metadata = { title: "Baixar relatório" };

export default async function DownloadReportPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "reports.read")) return <AccessDenied />;
  const { runId } = await searchParams;
  const run = await getRunCsv(context, runId);
  if (!run) return <NotFound />;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Relatórios", href: "/relatorios" }, { label: "Baixar" }]} />
      <PageHeader title="Relatório pronto" description={`Baixe o CSV de ${run.fileName}.`} />
      <Card>
        <CardBody>
          <form action="/relatorios/baixar">
            <input type="hidden" name="id" value={runId} />
            <button type="submit" className="rounded-full border border-brand bg-brand text-white px-4 py-2 font-medium hover:bg-brand-strong">
              Baixar CSV
            </button>
          </form>
          <textarea readOnly className="mt-4 w-full h-64 font-mono text-xs text-ink-muted break-all">{run.content}</textarea>
        </CardBody>
      </Card>
      <LinkButton href="/relatorios" variant="secondary">Voltar</LinkButton>
    </>
  );
}

function NotFound() {
  return (
    <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Relatórios", href: "/relatorios" }]} /><PageHeader title="Relatório não encontrado" /><Card><CardBody>Este relatório não existe ou não está disponível para você.</CardBody></Card></>
  );
}
