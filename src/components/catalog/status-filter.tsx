import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

export function StatusFilter({
  basePath,
  value,
  label,
  options,
  query,
}: {
  basePath: string;
  value: "ativo" | "inativo" | "";
  label: string;
  options: { all: string; active: string; inactive: string };
  /** When defined (even ""), also shows a name search field named `q` with this default value. */
  query?: string;
}) {
  const hasFilter = Boolean(value || (query !== undefined && query.trim() !== ""));

  return (
    <Form
      action={basePath}
      role="search"
      aria-label={label}
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3"
    >
      {query !== undefined ? (
        <div className="space-y-1.5">
          <label htmlFor="filtro-busca" className="block text-sm font-medium text-ink">
            Buscar por nome
          </label>
          <Input
            type="search"
            name="q"
            id="filtro-busca"
            defaultValue={query}
            maxLength={80}
            autoComplete="off"
            className="w-56"
          />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
          Situação
        </label>
        <Select id="filtro-situacao" name="situacao" defaultValue={value} className="w-44">
          <option value="">{options.all}</option>
          <option value="ativo">{options.active}</option>
          <option value="inativo">{options.inactive}</option>
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
      {hasFilter ? (
        <LinkButton href={basePath} variant="ghost">
          Limpar filtro
        </LinkButton>
      ) : null}
    </Form>
  );
}
