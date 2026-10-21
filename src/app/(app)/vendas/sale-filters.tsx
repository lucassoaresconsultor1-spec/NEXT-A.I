import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type { SaleStatus } from "@/server/sales/schemas";

/** URL values in pt-BR (?situacao=finalizada) mapped to the service's status keys. */
export const STATUS_PARAMS: Record<string, SaleStatus> = {
  finalizada: "completed",
  cancelada: "cancelled",
  suspensa: "suspended",
  descartada: "discarded",
};

export const STATUS_TONES: Record<SaleStatus, "positive" | "critical" | "attention" | "neutral"> = {
  completed: "positive",
  cancelled: "critical",
  suspended: "attention",
  discarded: "neutral",
};

export function statusToParam(status: SaleStatus | undefined) {
  return Object.entries(STATUS_PARAMS).find(([, value]) => value === status)?.[0] ?? "";
}

export interface SaleFilterValues {
  loja: string;
  situacao: string;
  numero: string;
  de: string;
  ate: string;
}

export function SaleFilters({ values, stores }: { values: SaleFilterValues; stores: { id: string; code: string; name: string }[] }) {
  const hasFilter = Object.values(values).some((value) => value !== "");
  return (
    <Form action="/vendas" role="search" aria-label="Filtrar vendas" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
      <div className="space-y-1.5">
        <label htmlFor="filtro-loja" className="block text-sm font-medium text-ink">
          Loja
        </label>
        <Select id="filtro-loja" name="loja" defaultValue={values.loja} className="w-52">
          <option value="">Todas as lojas do meu acesso</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.code} · {store.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
          Situação
        </label>
        <Select id="filtro-situacao" name="situacao" defaultValue={values.situacao} className="w-40">
          <option value="">Todas</option>
          <option value="finalizada">Finalizadas</option>
          <option value="cancelada">Canceladas</option>
          <option value="suspensa">Suspensas</option>
          <option value="descartada">Descartadas</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-numero" className="block text-sm font-medium text-ink">
          Número
        </label>
        <Input id="filtro-numero" name="numero" defaultValue={values.numero} inputMode="numeric" maxLength={10} autoComplete="off" className="w-28" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-de" className="block text-sm font-medium text-ink">
          De
        </label>
        <Input type="date" id="filtro-de" name="de" defaultValue={values.de} aria-describedby="filtro-datas-dica" className="w-40" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-ate" className="block text-sm font-medium text-ink">
          Até
        </label>
        <Input type="date" id="filtro-ate" name="ate" defaultValue={values.ate} aria-describedby="filtro-datas-dica" className="w-40" />
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
      {hasFilter ? (
        <LinkButton href="/vendas" variant="ghost">
          Limpar filtros
        </LinkButton>
      ) : null}
      <p id="filtro-datas-dica" className="w-full text-xs text-ink-muted">
        Datas no fuso da empresa.
      </p>
    </Form>
  );
}
