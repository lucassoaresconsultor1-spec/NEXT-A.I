import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type { CatalogOption } from "@/server/catalog/options";

export interface ProductFilterValues {
  q: string;
  situacao: "ativo" | "inativo" | "";
  categoria: string;
  marca: string;
  fornecedor: string;
}

function OptionSelect({ id, name, label, value, empty, options }: { id: string; name: string; label: string; value: string; empty: string; options: CatalogOption[] }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <Select id={id} name={name} defaultValue={value} className="w-48">
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Plain GET form: works without JavaScript and keeps the filters in the URL (pt-BR keys). */
export function ProductFilters({
  values,
  options,
}: {
  values: ProductFilterValues;
  options: { categories: CatalogOption[]; brands: CatalogOption[]; suppliers: CatalogOption[] };
}) {
  const hasFilter = Object.values(values).some((value) => value !== "");
  return (
    <Form action="/produtos" role="search" aria-label="Filtrar produtos" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
      <div className="space-y-1.5">
        <label htmlFor="filtro-produto" className="block text-sm font-medium text-ink">
          Buscar por nome, SKU ou código de barras
        </label>
        <Input type="search" id="filtro-produto" name="q" defaultValue={values.q} maxLength={80} autoComplete="off" className="w-72 max-w-full" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
          Situação
        </label>
        <Select id="filtro-situacao" name="situacao" defaultValue={values.situacao} className="w-40">
          <option value="">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </Select>
      </div>
      <OptionSelect id="filtro-categoria" name="categoria" label="Categoria" value={values.categoria} empty="Todas" options={options.categories} />
      <OptionSelect id="filtro-marca" name="marca" label="Marca" value={values.marca} empty="Todas" options={options.brands} />
      <OptionSelect id="filtro-fornecedor" name="fornecedor" label="Fornecedor" value={values.fornecedor} empty="Todos" options={options.suppliers} />
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
      {hasFilter ? (
        <LinkButton href="/produtos" variant="ghost">
          Limpar filtros
        </LinkButton>
      ) : null}
    </Form>
  );
}
