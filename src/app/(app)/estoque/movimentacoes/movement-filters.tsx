import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES } from "@/server/inventory/schemas";
import type { StoreChoice } from "../stock-filters";

export interface MovementFilterValues {
  loja: string;
  tipo: string;
  de: string;
  ate: string;
}

/** Plain GET form; the type keeps the service's enum key in the URL (tipo=entry). */
export function MovementFilters({ values, stores }: { values: MovementFilterValues; stores: StoreChoice[] }) {
  const hasFilter = Object.values(values).some((value) => value !== "");
  return (
    <Form
      action="/estoque/movimentacoes"
      role="search"
      aria-label="Filtrar movimentações"
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3"
    >
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
        <label htmlFor="filtro-tipo" className="block text-sm font-medium text-ink">
          Tipo
        </label>
        <Select id="filtro-tipo" name="tipo" defaultValue={values.tipo} className="w-44">
          <option value="">Todos</option>
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {MOVEMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
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
        <LinkButton href="/estoque/movimentacoes" variant="ghost">
          Limpar filtros
        </LinkButton>
      ) : null}
      <p id="filtro-datas-dica" className="w-full text-xs text-ink-muted">
        Datas no fuso da empresa.
      </p>
    </Form>
  );
}
