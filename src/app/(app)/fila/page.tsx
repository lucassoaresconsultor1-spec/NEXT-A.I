import { Users } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listDevices } from "@/server/devices/service";
import { getQueue, queueStats } from "@/server/queue/service";
import { listStoreOptions } from "@/server/stores/options";
import { todayIn } from "@/server/targets/schemas";
import { AssignDialog, CreateDeviceForm, DeviceActions, PinForm } from "./queue-manager";

export const metadata: Metadata = { title: "Fila de atendimento" };

const DEVICE_STATUS = { pending: { label: "Aguardando pareamento", tone: "attention" }, active: { label: "Ativo", tone: "positive" }, revoked: { label: "Revogado", tone: "neutral" } } as const;
const PRESENCE = { available: { label: "Disponível", tone: "positive" }, busy: { label: "Atendendo", tone: "attention" }, away: { label: "Ausente", tone: "neutral" } } as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function QueuePage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "queue.read")) return <AccessDenied />;
  const requested = (await searchParams).loja;
  const stores = await listStoreOptions(context);
  const store = stores.find((item) => item.id === (typeof requested === "string" ? requested : context.activeStoreId)) ?? stores[0];
  const tz = context.organization.timezone;
  const time = (value: Date | null) => (value ? new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(value) : "");
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Fila" }]} />
      <PageHeader title="Fila de atendimento" description={store ? `${store.code} · ${store.name}. A operação da fila é feita no tablet da entrada (/tablet).` : undefined} />
    </>
  );
  if (!store) return <>{header}<Notice tone="warning" title="Nenhuma loja ativa no seu acesso." /></>;
  const today = todayIn(tz);
  const [queue, stats, devices] = await Promise.all([
    getQueue(context, store.id),
    queueStats(context, { storeId: store.id, from: today, to: today }),
    can(context, "queue.devices.manage") ? listDevices(context, { storeId: store.id }) : Promise.resolve(null),
  ]);
  const free = queue.presence.filter((row) => row.status !== "busy").map((row) => ({ id: row.salespersonId, name: row.nickname }));
  const waiting = queue.entries.filter((entry) => entry.status === "waiting");
  const inService = queue.entries.filter((entry) => entry.status === "in_service");
  const canAssign = can(context, "queue.assign_manual") && free.length > 0;

  return (
    <>
      {header}
      {stores.length > 1 ? (
        <nav aria-label="Lojas" className="flex flex-wrap gap-2">
          {stores.map((item) => (
            <a key={item.id} href={`/fila?loja=${item.id}`} aria-current={item.id === store.id ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${item.id === store.id ? "border-brand bg-brand-soft text-brand-strong" : "border-line-strong"}`}>
              {item.code}
            </a>
          ))}
        </nav>
      ) : null}
      <Card>
        <CardHeader title="Hoje" description="Conversão = atendimentos encerrados com venda ÷ atendimentos encerrados; desistências contadas à parte." />
        <CardBody>
          <DetailList items={[
            { label: "Encerrados", value: String(stats.finished) },
            { label: "Com venda", value: String(stats.withSale) },
            { label: "Conversão", value: `${stats.conversion.replace(".", ",")}%` },
            { label: "Desistências", value: String(stats.abandoned) },
          ]} />
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Aguardando" description={`${waiting.length} cliente(s)`} />
          {waiting.length === 0 ? <EmptyState icon={Users} title="Ninguém aguardando" /> : (
            <ul className="divide-y divide-line" aria-label="Aguardando">
              {waiting.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <span><span className="font-mono font-semibold">{entry.ticket}</span> <span className="text-sm text-ink-muted">chegou {time(entry.arrivedAt)}{entry.note ? ` · ${entry.note}` : ""}</span></span>
                  {canAssign ? <AssignDialog entryId={entry.id} ticket={entry.ticket} salespeople={free} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Em atendimento" description={`${inService.length} atendimento(s)`} />
          {inService.length === 0 ? <CardBody><p className="text-sm text-ink-muted">Nenhum atendimento em andamento.</p></CardBody> : (
            <ul className="divide-y divide-line" aria-label="Em atendimento">
              {inService.map((entry) => <li key={entry.id} className="px-4 py-3"><span className="font-mono font-semibold">{entry.ticket}</span> <span className="text-sm text-ink-muted">{entry.nickname} · desde {time(entry.startedAt)}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Vendedores na fila" description="Ordem do rodízio: disponíveis há mais tempo primeiro." />
        {queue.presence.length === 0 ? <CardBody><p className="text-sm text-ink-muted">Nenhum vendedor entrou na fila hoje.</p></CardBody> : (
          <ul className="divide-y divide-line">
            {queue.presence.map((row) => (
              <li key={row.salespersonId} className="flex items-center justify-between gap-2 px-4 py-3">
                <span><span className="font-medium">{row.nickname}</span> <span className="text-xs text-ink-muted">{row.code} · desde {time(row.since)}</span></span>
                <Badge tone={PRESENCE[row.status].tone}>{PRESENCE[row.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {devices ? (
        <Card>
          <CardHeader title="Tablets da loja" description="O código de pareamento aparece uma única vez e vale 10 minutos." />
          <CardBody className="space-y-4">
            <CreateDeviceForm storeId={store.id} />
            {devices.length === 0 ? <p className="text-sm text-ink-muted">Nenhum tablet cadastrado.</p> : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {devices.map((device) => (
                  <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span>
                      <span className="font-medium">{device.name}</span> <Badge tone={DEVICE_STATUS[device.status].tone}>{DEVICE_STATUS[device.status].label}</Badge>
                      {device.lastSeenAt ? <span className="block text-xs text-ink-muted">Último uso {time(device.lastSeenAt)}</span> : null}
                    </span>
                    {device.status === "revoked" ? null : <DeviceActions deviceId={device.id} name={device.name} pending={device.status === "pending"} />}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Meu PIN de fila" description="Usado para se identificar no tablet da entrada. 6 números, sem sequências nem repetições." />
        <CardBody><PinForm /></CardBody>
      </Card>
    </>
  );
}
