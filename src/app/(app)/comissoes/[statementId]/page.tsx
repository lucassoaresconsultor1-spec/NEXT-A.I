import type { Metadata } from "next";
import { List } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getStatement } from "@/server/commissions/statements";
import { STATEMENT_STATUS_LABELS, type StatementStatus } from "@/server/commissions/schemas";
import { StatementActions } from "../statement-actions";

type SearchParams = Promise<{ statementId: string }>;

export const metadata: Metadata = { title: "Detalhe da apuração" };

export default async function StatementDetailPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "commissions.read")) return <AccessDenied />;
  const { statementId } = await searchParams;
  const statement = await getStatement(context, statementId);
  if (!statement) return <NotFound />;
  const status = statement.status as StatementStatus;
  const canApprove = can(context, "commissions.approve") && status === "calculated";
  const canPay = can(context, "commissions.pay") && status === "approved";
  const canCancel = can(context, "commissions.manage") && (status === "calculated" || status === "approved");

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Comissões", href: "/comissoes" }, { label: "Detalhe" }]} />
      <PageHeader title="Apuração de comissão" description={`Vendedor · ${statement.month}`} />
      <Card>
        <CardBody>
          <DetailList items={[
            { label: "Situação", value: <Badge tone={status === "paid" ? "positive" : status === "cancelled" ? "critical" : status === "approved" ? "brand" : "neutral"}>{STATEMENT_STATUS_LABELS[status]}</Badge> },
            { label: "Mês", value: statement.month },
            { label: "Base", value: formatCurrencyCents(statement.baseCents) },
            { label: "Comissão", value: formatCurrencyCents(statement.commissionCents) },
            { label: "Calculada em", value: statement.calculatedAt ? formatDate(new Date(statement.calculatedAt)) : "—" },
            { label: "Vendedor", value: String(statement.salespersonId) },
          ]} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Linhas da apuração" description="Cada linha mostra a base, a taxa e o valor da comissão." />
        <CardBody>
          {statement.lines.length === 0 ? <EmptyState icon={List} title="Sem linhas." description="Esta apuração não tem itens de comissão." /> : (
            <Table caption="Linhas de comissão"><thead><tr><Th>Venda</Th><Th>Tipo</Th><Th>Base (R$)</Th><Th>Taxa</Th><Th>Comissão (R$)</Th><Th>Regra</Th></tr></thead>
              <tbody>{statement.lines.map((line) => <Tr key={line.saleItemId}>
                <Td className="font-mono text-xs text-ink-soft">{line.saleId}</Td>
                <Td>{line.kind === "sale" ? "Venda" : "Devolução"}</Td>
                <Td className="tabular-nums">{formatCurrencyCents(line.baseCents)}</Td>
                <Td className="tabular-nums">{line.rateBps / 100}%</Td>
                <Td className="tabular-nums">{formatCurrencyCents(line.commissionCents)}</Td>
                <Td>{line.ruleId ?? "—"}</Td>
              </Tr>)}</tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {(canApprove || canPay || canCancel) && (
        <Card>
          <CardHeader title="Ações" />
          <CardBody><StatementActions statementId={statementId} status={status} canApprove={canApprove} canPay={canPay} canCancel={canCancel} /></CardBody>
        </Card>
      )}

      <LinkButton href="/comissoes" variant="secondary">Voltar</LinkButton>
    </>
  );
}

function NotFound() {
  return (
    <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Comissões", href: "/comissoes" }]} /><PageHeader title="Apuração não encontrada" /><Card><CardBody><Notice tone="error" title="Esta apuração não existe ou você não tem acesso a ela." /></CardBody></Card></>
  );
}


