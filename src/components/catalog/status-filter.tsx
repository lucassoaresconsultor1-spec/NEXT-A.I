import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Select } from "@/components/ui/form";

export function StatusFilter({
  basePath,
  value,
  label,
  options,
}: {
  basePath: string;
  value: "ativo" | "inativo" | "";
  label: string;
  options: { all: string; active: string; inactive: string };
}) {
  return (
    <Form
      action={basePath}
      role="search"
      aria-label={label}
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3"
    >
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
      {value ? (
        <LinkButton href={basePath} variant="ghost">
          Limpar filtro
        </LinkButton>
      ) : null}
    </Form>
  );
}
