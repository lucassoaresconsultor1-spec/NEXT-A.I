import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";

const FEATURE_LABELS: Record<string, string> = {
  pos: "PDV",
  inventory: "Estoque",
  basic_reports: "Relatórios básicos",
  targets_commissions: "Metas e comissões",
  service_queue: "Fila de atendimento",
  advanced_reports: "Relatórios avançados",
  alerts: "Alertas",
  ai_assistant: "Assistente de IA",
  ai_reports: "Relatórios por IA",
  multi_store: "Múltiplas lojas",
  regional_consolidation: "Consolidação regional",
};

// Features whose module is already delivered. Everything else is listed as
// planned ("previsto") so the page never implies an unreleased module works.
const RELEASED_FEATURES: ReadonlySet<string> = new Set(["multi_store"]);

export interface PlanSummary {
  name: string;
  description: string;
  maxStores: number | null;
  maxMembers: number | null;
  features: string[];
}

function limitText(max: number | null, singular: string, plural: string) {
  if (max === null) return "Sem limite";
  return `Até ${formatInteger(max)} ${max === 1 ? singular : plural}`;
}

function UsageRow({
  label,
  max,
  used,
  singular,
  plural,
}: {
  label: string;
  max: number | null;
  used: number | null;
  singular: string;
  plural: string;
}) {
  const over = used !== null && max !== null && used > max;
  const ratio = used !== null && max ? Math.min(1, used / max) : 0;
  return (
    <div className="space-y-1.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="space-y-1.5 text-sm text-ink">
        <p className="font-medium">{limitText(max, singular, plural)}</p>
        {used !== null ? (
          <>
            <p className={cn("text-xs", over ? "font-medium text-attention" : "text-ink-soft")}>
              {formatInteger(used)} em uso{over ? " · acima do limite: novos cadastros ficam bloqueados" : ""}
            </p>
            {max !== null ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
                <div className={cn("h-full rounded-full", over ? "bg-attention" : "bg-brand")} style={{ width: `${ratio * 100}%` }} />
              </div>
            ) : null}
          </>
        ) : null}
      </dd>
    </div>
  );
}

export function PlanCard({ plan, usage }: { plan: PlanSummary; usage: { stores: number; members: number } | null }) {
  return (
    <Card>
      <CardHeader title="Plano" description="Limites e recursos contratados pela empresa." />
      <CardBody className="space-y-5">
        <div className="space-y-1">
          <p className="text-lg font-semibold text-ink">{plan.name}</p>
          <p className="text-sm text-ink-soft">{plan.description}</p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <UsageRow label="Lojas ativas" max={plan.maxStores} used={usage?.stores ?? null} singular="loja" plural="lojas" />
          <UsageRow label="Membros ativos" max={plan.maxMembers} used={usage?.members ?? null} singular="membro" plural="membros" />
        </dl>
        {usage === null ? (
          <p className="text-xs text-ink-muted">O uso atual é exibido para quem tem acesso a todas as lojas da empresa.</p>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Recursos incluídos</h3>
          {plan.features.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum recurso adicional neste plano.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-ink">{FEATURE_LABELS[feature] ?? feature}</span>
                  {RELEASED_FEATURES.has(feature) ? <Badge tone="positive">Disponível</Badge> : <Badge>Previsto</Badge>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">
            Recursos marcados como “previsto” fazem parte do plano, mas o módulo correspondente ainda não foi lançado.
          </p>
        </div>
        <Notice tone="info" title="Para alterar o plano, fale com o suporte da plataforma.">
          Planos são alterados pela administração da plataforma; os novos limites valem para os próximos cadastros.
        </Notice>
      </CardBody>
    </Card>
  );
}
