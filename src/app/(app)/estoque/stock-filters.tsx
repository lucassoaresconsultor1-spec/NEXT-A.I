import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

export interface StoreChoice {
  id: string;
  code: string;
  name: string;
}

/** Plain GET form: works without JavaScript and keeps the filters in the URL (pt-BR keys). */
export function StockFilters({ values, stores }: { values: { loja: string; q: string }; stores: StoreChoice[] }) {
  const hasFilter = Boolean(values.loja || values.q);
  return (
    <Form action="/estoque" role="search" aria-label="Filtrar saldos" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
      <div className="space-y-1.5">
        <label htmlFor="filtro-loja" className="block text-sm font-medium text-ink">
          Loja
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
        <label htmlFor="filtro-busca" className="block text-sm font-medium text-ink">
          Buscar por produto, SKU ou código de barras
        </label>
        <Input type="search" id="filtro-busca" name="q" defaultValue={values.q} maxLength={80} autoComplete="off" className="w-72 max-w-full" />
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
      {hasFilter ? (
        <LinkButton href="/estoque" variant="ghost">
          Limpar filtros
        </LinkButton>
      ) : null}
    </Form>
  );
}
