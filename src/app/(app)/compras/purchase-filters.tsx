import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { PURCHASE_ORDER_STATUS_LABELS, PURCHASE_ORDER_STATUSES } from "@/server/purchasing/schemas";

/** Badge tone per order status, shared by the list and the detail page. */
export const STATUS_TONES = {
  draft: "neutral",
  approved: "brand",
  partially_received: "attention",
  received: "positive",
  cancelled: "critical",
} as const;

/** Calendar date ("YYYY-MM-DD") shown as dd/mm/aaaa without shifting the day across time zones. */
export function formatCalendarDate(value: string | null) {
  return value ? formatDate(new Date(`${value}T12:00:00Z`), "UTC") : "—";
}

export interface PurchaseFilterValues {
  situacao: string;
  loja: string;
  fornecedor: string;
  numero: string;
}

interface Choice {
  id: string;
  name: string;
}

/** Plain GET form; the status keeps the service's enum key in the URL. */
export function PurchaseFilters({
  values,
  stores,
  suppliers,
}: {
  values: PurchaseFilterValues;
  stores: (Choice & { code: string })[];
  suppliers: Choice[];
}) {
  const hasFilter = Object.values(values).some((value) => value !== "");
  return (
    <Form action="/compras" role="search" aria-label="Filtrar pedidos de compra" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
      <div className="space-y-1.5">
        <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
          Situação
        </label>
        <Select id="filtro-situacao" name="situacao" defaultValue={values.situacao} className="w-44">
          <option value="">Todas</option>
          {PURCHASE_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PURCHASE_ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>
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
        <label htmlFor="filtro-fornecedor" className="block text-sm font-medium text-ink">
          Fornecedor
        </label>
        <Select id="filtro-fornecedor" name="fornecedor" defaultValue={values.fornecedor} className="w-52">
          <option value="">Todos</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-numero" className="block text-sm font-medium text-ink">
          Número
        </label>
        <Input id="filtro-numero" name="numero" defaultValue={values.numero} inputMode="numeric" maxLength={10} autoComplete="off" className="w-28" />
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
      {hasFilter ? (
        <LinkButton href="/compras" variant="ghost">
          Limpar filtros
        </LinkButton>
      ) : null}
    </Form>
  );
}
