import type { Metadata } from "next";
import { History } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { targetHistory } from "@/server/targets/service";
import { TARGET_SCOPE_LABELS } from "@/server/targets/schemas";

export const metadata: Metadata = { title: "Histórico de meta" };

export default async function TargetHistoryPage({ params }: { params: Promise<{ targetId: string }> }) {
  const context = await requireTenantContext();
  if (!can(context, "targets.read")) return <AccessDenied />;
  const { targetId } = await params;
  const history = await targetHistory(context, targetId);
  const current = history.at(-1);
  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Metas de venda", href: "/metas" }, { label: "Histórico" }]} />
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-xl font-semibold tracking-tight text-ink">Histórico da meta</h1>{current ? <p className="text-sm text-ink-muted">{TARGET_SCOPE_LABELS[current.scope]} · {current.month}</p> : null}</div>
      <LinkButton href="/metas" variant="secondary">Voltar às metas</LinkButton>
    </div>
    <Card>
      {!history.length ? <EmptyState icon={History} title="Ainda não há versões anteriores desta meta." /> : <Table caption="Versões da meta"><thead><tr><Th>Versão</Th><Th>Valor</Th><Th>Motivo</Th><Th>Registrada em</Th></tr></thead><tbody>
        {history.map((version) => <Tr key={version.id}><Td>v{version.version}</Td><Td className="font-medium tabular-nums">{formatCurrencyCents(version.amountCents)}</Td><Td>{version.reason ?? "Meta inicial"}</Td><Td>{formatDateTime(version.createdAt, context.organization.timezone)}</Td></Tr>)}
      </tbody></Table>}
    </Card>
  </>;
}
