"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

export interface StoreFilterValues {
  q?: string;
  status?: string;
  region?: string;
  sort?: string;
  dir?: string;
}

/**
 * GET form: filters live in the URL, so results can be shared and paginated on
 * the server. The current sort is kept; the page resets to the first one.
 */
export function StoreFilters({
  values,
  regions,
}: {
  values: StoreFilterValues;
  /** `null` when the member cannot see regions: the region filter is hidden. */
  regions: { id: string; name: string }[] | null;
}) {
  const filtered = Boolean(values.q || values.status || values.region);
  return (
    <Form action="/lojas" role="search" aria-label="Filtrar lojas" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4">
      <Field label="Buscar" className="min-w-56 flex-[2]">
        {(props) => (
          <Input {...props} type="search" name="q" defaultValue={values.q ?? ""} placeholder="Nome ou código da loja" maxLength={80} />
        )}
      </Field>
      <Field label="Situação" className="min-w-40 flex-1">
        {(props) => (
          <Select {...props} name="status" defaultValue={values.status ?? ""}>
            <option value="">Todas</option>
            <option value="active">Ativas</option>
            <option value="inactive">Inativas</option>
          </Select>
        )}
      </Field>
      {regions ? (
        <Field label="Região" className="min-w-40 flex-1">
          {(props) => (
            <Select {...props} name="region" defaultValue={values.region ?? ""}>
              <option value="">Todas</option>
              <option value="none">Sem região</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {values.sort ? <input type="hidden" name="sort" value={values.sort} /> : null}
      {values.dir ? <input type="hidden" name="dir" value={values.dir} /> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary">
          <Search className="size-4" aria-hidden /> Filtrar
        </Button>
        {filtered ? (
          <LinkButton href="/lojas" variant="ghost">
            Limpar
          </LinkButton>
        ) : null}
      </div>
    </Form>
  );
}
