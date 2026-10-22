import { Target, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { formatCurrencyCents } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { estimateCommission } from "@/server/commissions/calculate";
import { DomainError } from "@/server/errors";
import { getQueue } from "@/server/queue/service";
import { ownSalesMetrics, ownSalesperson } from "@/server/salespeople/self";
import { listStoreOptions } from "@/server/stores/options";
import { targetProgress } from "@/server/targets/progress";
import { monthRange, todayIn } from "@/server/targets/schemas";

// Salesperson's own view (m34), read only: my sales, goals, commission estimate and
// attendances. "Me" comes from the session (ownSalesperson), never from the request.

export const metadata: Metadata = { title: "Meu desempenho" };

/** A feature outside the plan shows as unavailable instead of failing the page. */
async function unlessUnavailable<T>(work: Promise<T>): Promise<T | "unavailable"> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof DomainError && error.code === "limit") return "unavailable";
    throw error;
  }
}

const percent = (value: string) => `${value.replace(".", ",")}%`;

export default async function MyPerformancePage() {
  const context = await requireTenantContext();
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Meu desempenho" }]} />
      <PageHeader title="Meu desempenho" description="Suas vendas, metas, comissão estimada e atendimentos." />
    </>
  );
  const me = await ownSalesperson(context);
  if (!me) return <>{header}<EmptyState icon={UserRound} title="Você não tem cadastro de vendedor" description="Peça ao gerente para cadastrar você em Vendedores." /></>;

  const tz = context.organization.timezone;
  const today = todayIn(tz);
  const month = today.slice(0, 7);
  const time = (value: Date | null) => (value ? new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(value) : "");
  const [stores, monthMetrics, dayMetrics, goals, commissions, queues] = await Promise.all([
    listStoreOptions(context),
    unlessUnavailable(ownSalesMetrics(context, monthRange(month))),
    unlessUnavailable(ownSalesMetrics(context, { from: today, to: today })),
    can(context, "targets.read") ? unlessUnavailable(targetProgress(context, { month, scope: "salesperson" })) : Promise.resolve(null),
    unlessUnavailable(Promise.all(me.storeIds.map(async (storeId) => ({ storeId, ...(await estimateCommission(context, { salespersonId: me.id, storeId, month })) })))),
    can(context, "queue.read") ? Promise.all(me.storeIds.map((storeId) => getQueue(context, storeId))) : Promise.resolve(null),
  ]);
  const storeName = new Map(stores.map((store) => [store.id, `${store.code} · ${store.name}`]));
  const myGoals = goals === null || goals === "unavailable" ? goals : goals.filter((goal) => goal.salespersonId === me.id);
  // Only my own attendances and presence leave the server.
  const mine = queues?.flatMap((queue, index) => queue.entries.filter((entry) => entry.salespersonId === me.id).map((entry) => ({ ...entry, storeId: me.storeIds[index] })));
  const presence = queues?.flatMap((queue) => queue.presence.filter((row) => row.salespersonId === me.id));
  const unavailable = <Notice tone="warning" title="Indisponível no plano atual da empresa." />;

  return (
    <>
      {header}
      <p className="text-sm text-ink-muted">{me.nickname} · código {me.code}</p>
      <Card>
        <CardHeader title="Minhas vendas" description="Vendas registradas com você como vendedor, já descontados cancelamentos e devoluções." />
        <CardBody>
          {monthMetrics === "unavailable" || dayMetrics === "unavailable" || !monthMetrics || !dayMetrics ? unavailable : (
            <DetailList items={[
              { label: "Hoje", value: formatCurrencyCents(dayMetrics.netRevenueCents) },
              { label: "No mês", value: formatCurrencyCents(monthMetrics.netRevenueCents) },
              { label: "Vendas no mês", value: String(monthMetrics.saleCount) },
              { label: "Ticket médio no mês", value: formatCurrencyCents(monthMetrics.averageTicketCents) },
              { label: "Itens por venda", value: monthMetrics.itemsPerSale.replace(".", ",") },
            ]} />
          )}
        </CardBody>
      </Card>
      {myGoals === null ? null : (
        <Card>
          <CardHeader title="Minhas metas do mês" description="Projeção linear pelos dias úteis já passados." />
          {myGoals === "unavailable" ? <CardBody>{unavailable}</CardBody> : myGoals.length === 0 ? <EmptyState icon={Target} title="Nenhuma meta individual neste mês" /> : (
            <ul className="divide-y divide-line">
              {myGoals.map((goal) => (
                <li key={goal.id} className="space-y-1 px-4 py-3">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{goal.storeId ? (storeName.get(goal.storeId) ?? "Loja") : "Loja"}</span>
                    <Badge tone={Number(goal.percent) >= 100 ? "positive" : "neutral"}>{percent(goal.percent)}</Badge>
                  </p>
                  <p className="text-sm text-ink-muted">
                    {formatCurrencyCents(goal.achievedCents)} de {formatCurrencyCents(goal.targetCents)} · projeção {formatCurrencyCents(goal.projectionCents)} · {goal.workingDaysElapsed} de {goal.workingDaysTotal} dias úteis
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card>
        <CardHeader title="Comissão estimada do mês" description="Estimativa pelas regras vigentes; o valor oficial é o da apuração feita pela gerência." />
        <CardBody>
          {commissions === "unavailable" ? unavailable : commissions.length === 0 ? <p className="text-sm text-ink-muted">Você não está vinculado a nenhuma loja do seu acesso.</p> : (
            <DetailList items={commissions.map((row) => ({ label: storeName.get(row.storeId) ?? "Loja", value: `${formatCurrencyCents(row.commissionCents)} sobre ${formatCurrencyCents(row.baseCents)}` }))} />
          )}
        </CardBody>
      </Card>
      {mine === undefined ? null : (
        <Card>
          <CardHeader title="Meus atendimentos agora" description={presence && presence.length > 0 ? `Situação na fila: ${presence.map((row) => (row.status === "available" ? "disponível" : row.status === "busy" ? "atendendo" : "ausente")).join(", ")}` : "Você não entrou na fila hoje."} />
          <CardBody>
            {mine.length === 0 ? <p className="text-sm text-ink-muted">Nenhum atendimento em andamento com você.</p> : (
              <ul className="divide-y divide-line">
                {mine.map((entry) => <li key={entry.id} className="py-2 text-sm"><span className="font-mono font-semibold">{entry.ticket}</span> · {storeName.get(entry.storeId) ?? "Loja"} · desde {time(entry.startedAt)}</li>)}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </>
  );
}
