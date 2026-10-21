import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { isDomainError } from "@/server/errors";
import { CASH_MOVEMENT_LABELS } from "@/server/cash/schemas";
import { getSessionSummary } from "@/server/cash/session-queries";
import { closeSessionAction, reopenSessionAction } from "../../actions";
import { CloseForm } from "../../close-form";
import { ReopenDialog } from "./reopen-dialog";

export const metadata: Metadata = { title: "Detalhe da sessão" };

export default async function SessionDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const context = await requireTenantContext();
  if (!can(context, "cash.read") && !can(context, "cash.operate")) return <AccessDenied />;
  const { sessionId } = await params;
  let session: Awaited<ReturnType<typeof getSessionSummary>>;
  try {
    session = await getSessionSummary(context, sessionId);
  } catch (error) {
    if (!isDomainError(error) || error.code !== "limit") throw error;
    return <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Sessões de caixa", href: "/caixa/sessoes" }]} /><Card><CardBody><Notice tone="warning" title={error.message} /></CardBody></Card></>;
  }
  if (!session) notFound();
  const tz = context.organization.timezone;
  const manager = can(context, "cash.manage");
  const canRead = can(context, "cash.read");
  const canSeeTotals = canRead || session.status === "closed";
  const mayClose = session.status === "open" && (session.openedBy.id === context.user.id || manager);
  const summaryItems = [
    { label: "Loja", value: session.storeName },
    { label: "Caixa", value: session.registerName },
    { label: "Operador", value: session.openedBy.name },
    { label: "Aberto em", value: formatDateTime(session.openedAt, tz) },
    ...(canSeeTotals ? [
      { label: "Abertura", value: formatCurrencyCents(session.totals.openingCents) },
      { label: "Suprimentos", value: formatCurrencyCents(session.totals.suppliesCents) },
      { label: "Sangrias", value: formatCurrencyCents(session.totals.withdrawalsCents) },
      { label: "Vendas em dinheiro", value: formatCurrencyCents(session.totals.salesCents) },
      { label: "Devoluções", value: formatCurrencyCents(session.totals.refundsCents) },
      { label: "Esperado", value: formatCurrencyCents(session.totals.expectedCents) },
      ...(session.status === "closed" ? [
        { label: "Contado", value: formatCurrencyCents(session.countedCents ?? 0) },
        { label: "Diferença", value: formatCurrencyCents(session.differenceCents ?? 0) },
        { label: "Fechado em", value: session.closedAt ? formatDateTime(session.closedAt, tz) : "—" },
      ] : []),
    ] : []),
  ];

  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Sessões de caixa", href: "/caixa/sessoes" }, { label: session.registerName }]} />
    <PageHeader title={session.registerName} description={`${session.storeName} · ${session.status === "open" ? "Sessão aberta" : "Sessão fechada"}`} actions={<div className="flex gap-2"><LinkButton href="/caixa/sessoes" variant="secondary">Voltar às sessões</LinkButton>{manager && session.status === "closed" ? <ReopenDialog sessionId={session.id} action={reopenSessionAction} /> : null}</div>} />
    <div className={`grid gap-4 ${canSeeTotals ? "lg:grid-cols-2" : ""}`}>
      <Card>
        <CardHeader title="Resumo" actions={<Badge tone={session.status === "open" ? "positive" : "neutral"}>{session.status === "open" ? "Aberta" : "Fechada"}</Badge>} />
        <CardBody className="space-y-4">
          <DetailList items={summaryItems} />
          {!canSeeTotals ? <p className="text-sm text-ink-muted">O saldo esperado ficará disponível após o fechamento do caixa.</p> : null}
        </CardBody>
      </Card>
      {canSeeTotals ? <Card>
        <CardHeader title="Eventos" />
        <CardBody className="space-y-3">
          {session.events.map((event, index) => <div key={`${event.type}-${index}`} className="border-l-2 border-brand pl-3 text-sm"><p className="font-medium">{event.type === "opened" ? "Aberto" : event.type === "closed" ? "Fechado" : "Reaberto"} · {event.actorName ?? "Usuário"}</p><p className="text-ink-muted">{formatDateTime(event.at, tz)}{event.reason ? ` · ${event.reason}` : ""}</p></div>)}
        </CardBody>
      </Card> : null}
    </div>
    {mayClose ? <Card className="mt-4"><CardHeader title="Fechar caixa" description="Informe o dinheiro contado antes de consultar o esperado." /><CardBody><CloseForm sessionId={session.id} action={closeSessionAction} /></CardBody></Card> : null}
    {canSeeTotals ? <Card className="mt-4"><CardHeader title="Movimentos" /><Table caption="Movimentos da sessão"><thead><tr><Th>Tipo</Th><Th>Valor</Th><Th>Motivo</Th><Th>Quem</Th><Th>Quando</Th></tr></thead><tbody>{session.movements.map((movement) => <Tr key={movement.id}><Td>{CASH_MOVEMENT_LABELS[movement.type]}</Td><Td className="tabular-nums">{formatCurrencyCents(movement.amountCents)}</Td><Td>{movement.reason ?? "—"}</Td><Td>{movement.createdByName ?? "—"}</Td><Td className="whitespace-nowrap">{formatDateTime(movement.createdAt, tz)}</Td></Tr>)}</tbody></Table></Card> : null}
  </>;
}
