"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

export interface PlatformFilterValues {
  q?: string;
  status?: string;
}

/** GET form: filters live in the URL; the page resets to the first one on submit. */
export function PlatformFilters({ values }: { values: PlatformFilterValues }) {
  const filtered = Boolean(values.q || values.status);
  return (
    <Form
      action="/plataforma"
      role="search"
      aria-label="Filtrar empresas"
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4"
    >
      <Field label="Buscar" className="min-w-56 flex-[2]">
        {(props) => (
          <Input {...props} type="search" name="q" defaultValue={values.q ?? ""} placeholder="Nome ou CNPJ da empresa" maxLength={120} />
        )}
      </Field>
      <Field label="Situação" className="min-w-40 flex-1">
        {(props) => (
          <Select {...props} name="status" defaultValue={values.status ?? ""}>
            <option value="">Todas</option>
            <option value="active">Ativas</option>
            <option value="suspended">Suspensas</option>
          </Select>
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="secondary">
          <Search className="size-4" aria-hidden /> Filtrar
        </Button>
        {filtered ? (
          <LinkButton href="/plataforma" variant="ghost">
            Limpar
          </LinkButton>
        ) : null}
      </div>
    </Form>
  );
}
