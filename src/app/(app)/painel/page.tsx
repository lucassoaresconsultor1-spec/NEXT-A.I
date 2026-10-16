import { CheckCircle2, Circle, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { formatDateTime, formatInteger } from "@/lib/format";
import { auditActionLabel } from "@/server/audit/labels";
import { listAuditLogs } from "@/server/audit/service";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getOverview } from "@/server/dashboard/overview";

export const metadata: Metadata = { title: "Painel" };

function Stat({ label, value, detail, href }: { label: string; value: string; detail?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-ink-muted">{detail}</p> : null}
    </>
  );
  return (
    <Card className="px-5 py-4">
      {href ? (
        <Link href={href} className="block rounded focus-visible:outline-offset-4">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function limitDetail(used: number, max: number | null) {
  return max === null ? `${formatInteger(used)} em uso · sem limite` : `${formatInteger(used)} de ${formatInteger(max)} no plano`;
}

export default async function DashboardPage({ searchParams }: PageProps<"/painel">) {
  const context = await requireTenantContext();
  const params = await searchParams;
  const overview = await getOverview(context);
  const recent = can(context, "audit.read") ? await listAuditLogs(context, { page: 1 }, 6) : null;
  const tz = context.organization.timezone;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel" }]} />
      <PageHeader
        title={`Olá, ${context.user.name.split(" ")[0]}`}
        description={`${context.organization.name} · ${context.role.name}${overview.activeStore ? ` · Loja ${overview.activeStore.code} – ${overview.activeStore.name}` : ""}`}
      />
      {params["boas-vindas"] ? (
        <Notice tone="success" title="Conta criada">
          A empresa está pronta. Comece pelos primeiros passos abaixo.
        </Notice>
      ) : null}
      {params["senha-alterada"] ? <Notice tone="success" title="Senha alterada com sucesso." /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Lojas ativas"
          value={formatInteger(overview.stores.active)}
          detail={overview.plan ? limitDetail(overview.plan.usage.stores, overview.plan.maxStores) : `${formatInteger(overview.stores.total)} no seu acesso`}
          href={can(context, "stores.read") ? "/lojas" : undefined}
        />
        {overview.regions !== null ? <Stat label="Regiões" value={formatInteger(overview.regions)} href="/regioes" /> : null}
        {overview.departments !== null ? (
          <Stat label="Departamentos ativos" value={formatInteger(overview.departments)} href="/departamentos" />
        ) : null}
        {overview.members !== null ? (
          <Stat
            label="Membros ativos"
            value={formatInteger(overview.members)}
            detail={overview.plan ? limitDetail(overview.plan.usage.members, overview.plan.maxMembers) : undefined}
            href="/equipe"
          />
        ) : null}
      </div>

      <Notice tone="info" title="Indicadores comerciais">
        Vendas, metas, estoque e atendimento aparecerão aqui quando os módulos de PDV, estoque e fila estiverem em
        operação. Nenhum número é exibido sem dados reais.
      </Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        {overview.onboarding ? (
          <Card>
            <CardHeader title="Primeiros passos" description="Configuração mínima para operar a empresa." />
            <CardBody>
              <ul className="space-y-3">
                {overview.onboarding.map((step) => (
                  <li key={step.label} className="flex items-center gap-3 text-sm">
                    {step.done ? (
                      <CheckCircle2 className="size-5 text-positive" aria-label="Concluído" />
                    ) : (
                      <Circle className="size-5 text-line-strong" aria-label="Pendente" />
                    )}
                    {step.done ? (
                      <span className="text-ink-muted line-through">{step.label}</span>
                    ) : (
                      <Link href={step.href} className="font-medium text-brand hover:underline">
                        {step.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
        {recent ? (
          <Card>
            <CardHeader
              title="Atividade recente"
              actions={
                <Link href="/auditoria" className="text-xs font-medium text-brand hover:underline">
                  Ver auditoria
                </Link>
              }
            />
            {recent.rows.length === 0 ? (
              <EmptyState icon={History} title="Sem atividade registrada" />
            ) : (
              <ul className="divide-y divide-line">
                {recent.rows.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium text-ink">{auditActionLabel(entry.action)}</span>
                      <span className="text-ink-muted"> · {entry.actorName ?? "Sistema"}</span>
                    </span>
                    <time className="shrink-0 text-xs text-ink-muted" dateTime={entry.createdAt.toISOString()}>
                      {formatDateTime(entry.createdAt, tz)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
