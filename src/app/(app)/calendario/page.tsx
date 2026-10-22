import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { Field, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { holidayFiltersSchema } from "@/server/calendar/schemas";
import { getStoreWorkWeek, listHolidays } from "@/server/calendar/service";
import { listStoreOptions } from "@/server/stores/options";
import { deleteHolidayAction, saveHolidayAction, saveWorkWeekAction } from "./actions";
import { HolidayDialogs, WorkWeekForm } from "./calendar-forms";

export const metadata: Metadata = { title: "Calendário" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function currentYear(timeZone: string) {
  return Number(new Intl.DateTimeFormat("en", { timeZone, year: "numeric" }).format(new Date()));
}

function formatCalendarDay(day: string) {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "organization.settings.read")) return <AccessDenied />;
  const raw = await searchParams;
  const stores = await listStoreOptions(context);
  const requestedStore = typeof raw.loja === "string" ? raw.loja : undefined;
  const selectedStore = stores.find((store) => store.id === requestedStore) ?? null;
  const yearResult = holidayFiltersSchema.safeParse({ year: raw.ano ?? currentYear(context.organization.timezone) });
  const year = yearResult.success ? yearResult.data.year : currentYear(context.organization.timezone);
  const canManage = can(context, "settings.operations.manage");
  let holidays: Awaited<ReturnType<typeof listHolidays>> = [];
  let workWeek: number[] | null = null;
  let readFailed = false;
  try {
    holidays = await listHolidays(context, { year, ...(selectedStore ? { storeId: selectedStore.id } : {}) });
    if (selectedStore) workWeek = await getStoreWorkWeek(context, selectedStore.id);
  } catch {
    readFailed = true;
  }

  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const mayManageHoliday = (storeId: string | null) => canManage && (storeId ? storeNames.has(storeId) : context.storeScope.all);
  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Calendário" }]} />
      <PageHeader title="Calendário" description="Feriados, pontos facultativos e dias de trabalho das lojas." />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Feriados e pontos facultativos" description="Cadastre as datas que afetam a operação da empresa ou de uma loja." />
          <CardBody className="space-y-4">
            <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Ano">
                {(props) => <input {...props} name="ano" type="number" min={2000} max={2100} defaultValue={year} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25" />}
              </Field>
              <Field label="Loja">
                {(props) => <Select {...props} name="loja" defaultValue={selectedStore?.id ?? ""}><option value="">Todas as lojas</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}
              </Field>
              <Button type="submit" variant="secondary">Filtrar</Button>
            </form>
            {canManage && (context.storeScope.all || stores.length > 0) ? <HolidayDialogs stores={stores.map(({ id, name }) => ({ id, name }))} canCreateOrganizationWide={context.storeScope.all} saveAction={saveHolidayAction} deleteAction={deleteHolidayAction} /> : null}
            {readFailed ? <Notice tone="error" title="Não foi possível carregar o calendário. Tente novamente." /> : holidays.length === 0 ? <EmptyState icon={CalendarDays} title="Nenhuma data cadastrada para este período." /> : (
              <ul className="divide-y divide-line" aria-label="Feriados e pontos facultativos">
                {holidays.map((holiday) => {
                  const editable = mayManageHoliday(holiday.storeId);
                  const storeName = holiday.storeId ? storeNames.get(holiday.storeId) ?? "Loja do seu escopo" : "Empresa";
                  return <li key={holiday.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{formatCalendarDay(holiday.day)} · {holiday.name}</p>
                      <p className="text-sm text-ink-muted">{holiday.kind === "holiday" ? "Feriado" : "Ponto facultativo"} · {storeName} · {holiday.closed ? "Loja fechada" : "Loja aberta"}</p>
                    </div>
                    {editable ? <HolidayDialogs stores={stores.map(({ id, name }) => ({ id, name }))} canCreateOrganizationWide={context.storeScope.all} holiday={{ ...holiday, storeName }} saveAction={saveHolidayAction} deleteAction={deleteHolidayAction} /> : null}
                  </li>;
                })}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Dias de trabalho" description="Configure os dias úteis usados nos cálculos operacionais da loja." />
          <CardBody className="space-y-4">
            {stores.length === 0 ? <EmptyState icon={CalendarDays} title="Nenhuma loja disponível" description="Peça acesso a uma loja para configurar os dias de trabalho." /> : <>
              {!selectedStore ? <Notice title="Selecione uma loja no filtro acima para consultar ou editar os dias de trabalho." /> : <>
                {workWeek === null ? <Notice title="A loja usa os dias padrão: segunda a sexta-feira." /> : null}
                {canManage ? <WorkWeekForm storeId={selectedStore.id} weekdays={workWeek ?? [1, 2, 3, 4, 5]} action={saveWorkWeekAction} /> : <p className="text-sm text-ink-muted">{workWeek?.length ? `Dias configurados: ${workWeek.map((day) => WEEKDAY_LABELS[day]).join(", ")}.` : "A loja usa os dias padrão: segunda a sexta-feira."}</p>}
              </>}
            </>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

const WEEKDAY_LABELS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
