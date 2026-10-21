import { randomUUID } from "node:crypto";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Field, Select } from "@/components/ui/form";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { isDomainError } from "@/server/errors";
import { findOpenSessionForOperator, getSessionSummary } from "@/server/cash/session-queries";
import { listRegisters } from "@/server/cash/registers";
import { listStoreOptions } from "@/server/stores/options";
import { openSessionAction, closeSessionAction, recordMovementAction } from "./actions";
import { CashMovementDialogs, OpenCashForm } from "./cash-dialogs";
import { CloseForm } from "./close-form";

export const metadata: Metadata = { title: "Caixa" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CashPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "cash.operate") && !can(context, "cash.read")) return <AccessDenied />;
  const raw = await searchParams;
  const stores = await listStoreOptions(context);
  const requested = typeof raw.loja === "string" ? raw.loja : undefined;
  const store = stores.find((row) => row.id === (requested ?? context.activeStoreId)) ?? stores[0];
  const mayOperate = can(context, "cash.operate");
  const canRead = can(context, "cash.read");
  const session = store && mayOperate ? await findOpenSessionForOperator(context, store.id) : null;
  let registers: Awaited<ReturnType<typeof listRegisters>> = [];
  let summary: Awaited<ReturnType<typeof getSessionSummary>> = null;
  let planMessage: string | undefined;
  try {
    if (store && !session && mayOperate) registers = await listRegisters(context, { storeId: store.id, status: "active" });
    else if (session) summary = await getSessionSummary(context, session.sessionId);
  } catch (error) {
    if (!isDomainError(error) || error.code !== "limit") throw error;
    planMessage = error.message;
  }
  if (planMessage) return <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Caixa" }]} /><PageHeader title="Caixa" description="Abertura, movimentações e fechamento do seu caixa." /><Card><CardBody><Notice tone="warning" title={planMessage} /></CardBody></Card></>;
  const available = registers.filter((row) => row.openSession === null);
  const tz = context.organization.timezone;
  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Caixa" }]} />
    <PageHeader title="Caixa" description="Abertura, movimentações e fechamento do seu caixa." />
    {stores.length > 1 ? <form className="mb-4 flex max-w-sm items-end gap-3" method="get"><Field label="Loja">{(props) => <Select {...props} name="loja" defaultValue={store?.id}>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}</Field><button className="rounded-full border px-4 py-2">Selecionar</button></form> : null}
    {!store ? <Card><EmptyState icon={Wallet} title="Nenhuma loja disponível" description="Peça acesso a uma loja para operar o caixa." /></Card> : null}
    {store && mayOperate && !session ? <Card><CardHeader title="Abrir caixa" description={`Loja: ${store.name}`} />{available.length ? <CardBody><OpenCashForm action={openSessionAction} registers={available.map(({ id, name }) => ({ id, name }))} idempotencyKey={randomUUID()} /></CardBody> : <CardBody><Notice title="Nenhum caixa livre nesta loja. Peça a um gerente para cadastrar ou liberar um caixa." /></CardBody>}</Card> : null}
    {store && session && summary ? <div className="space-y-4"><Card><CardHeader title={summary.registerName} description={`Aberto em ${formatDateTime(summary.openedAt, tz)} por ${summary.openedBy.name}`} actions={<Badge tone="positive">Aberto</Badge>} /><CardBody className="space-y-4">{canRead ? <DetailList items={[{ label: "Abertura", value: formatCurrencyCents(summary.totals.openingCents) }, { label: "Suprimentos", value: formatCurrencyCents(summary.totals.suppliesCents) }, { label: "Sangrias", value: formatCurrencyCents(summary.totals.withdrawalsCents) }, { label: "Esperado", value: formatCurrencyCents(summary.totals.expectedCents) }]} /> : <p className="text-sm text-ink-muted">O saldo esperado ficará disponível após o fechamento do caixa.</p>}<div className="flex flex-wrap gap-2"><CashMovementDialogs sessionId={session.sessionId} action={recordMovementAction} /><LinkButton href={`/caixa/sessoes/${session.sessionId}`} variant="secondary">Ver sessão</LinkButton></div></CardBody></Card><Card><CardHeader title="Fechar caixa" description="Informe o dinheiro contado antes de consultar o esperado." /><CardBody><CloseForm sessionId={session.sessionId} action={closeSessionAction} /></CardBody></Card></div> : null}
    {store && !mayOperate ? <Card><EmptyState icon={Wallet} title="Nenhum caixa aberto" description="Não há um caixa aberto para você nesta loja." /></Card> : null}
  </>;
}






