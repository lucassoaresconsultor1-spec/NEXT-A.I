import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUSES } from "@/server/inventory/transfer-schemas";

/** Badge tone per transfer status, shared by the list and the detail page. */
export const TRANSFER_TONES = {
  requested: "neutral",
  approved: "brand",
  in_transit: "attention",
  received: "positive",
  cancelled: "critical",
} as const;

export interface TransferFilterValues {
  situacao: string;
  loja: string;
  numero: string;
}

/** Plain GET form; the status keeps the service's enum key in the URL. */
export function TransferFilters({ values, stores }: { values: TransferFilterValues; stores: { id: string; code: string; name: string }[] }) {
  const hasFilter = Object.values(values).some((value) => value !== "");
  return (
    <Form
      action="/estoque/transferencias"
      role="search"
      aria-label="Filtrar transferências"
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3"
    >
      <div className="space-y-1.5">
        <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
          Situação
        </label>
        <Select id="filtro-situacao" name="situacao" defaultValue={values.situacao} className="w-44">
          <option value="">Todas</option>
          {TRANSFER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TRANSFER_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-loja" className="block text-sm font-medium text-ink">
          Loja (origem ou destino)
        </label>
        <Select id="filtro-loja" name="loja" defaultValue={values.loja} className="w-56">
          <option value="">Todas as lojas do meu acesso</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.code} · {store.name}
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
        <LinkButton href="/estoque/transferencias" variant="ghost">
          Limpar filtros
        </LinkButton>
      ) : null}
    </Form>
  );
}
