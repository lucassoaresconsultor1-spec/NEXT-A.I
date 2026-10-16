"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

export interface MemberFilterValues {
  q?: string;
  perfil?: string;
  situacao?: string;
  loja?: string;
  sort?: string;
  dir?: string;
}

/**
 * GET form: filters live in the URL so the server filters, sorts and paginates.
 * The current sort is kept; the page resets to the first one.
 */
export function MemberFilters({
  values,
  roles,
  stores,
}: {
  values: MemberFilterValues;
  roles: { id: string; name: string }[];
  /** `null` when the viewer cannot read stores: the store filter is hidden. */
  stores: { id: string; code: string; name: string }[] | null;
}) {
  const filtered = Boolean(values.q || values.perfil || values.situacao || values.loja);
  return (
    <Form action="/equipe" role="search" aria-label="Filtrar equipe" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4">
      <Field label="Buscar" className="min-w-56 flex-[2]">
        {(props) => <Input {...props} type="search" name="q" defaultValue={values.q ?? ""} placeholder="Nome ou e-mail" maxLength={80} />}
      </Field>
      <Field label="Perfil" className="min-w-40 flex-1">
        {(props) => (
          <Select {...props} name="perfil" defaultValue={values.perfil ?? ""}>
            <option value="">Todos</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Situação" className="min-w-36 flex-1">
        {(props) => (
          <Select {...props} name="situacao" defaultValue={values.situacao ?? ""}>
            <option value="">Todas</option>
            <option value="active">Ativos</option>
            <option value="suspended">Suspensos</option>
          </Select>
        )}
      </Field>
      {stores ? (
        <Field label="Com acesso à loja" className="min-w-44 flex-1">
          {(props) => (
            <Select {...props} name="loja" defaultValue={values.loja ?? ""}>
              <option value="">Todas</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name} ({store.code})
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
          <LinkButton href="/equipe" variant="ghost">
            Limpar
          </LinkButton>
        ) : null}
      </div>
    </Form>
  );
}
