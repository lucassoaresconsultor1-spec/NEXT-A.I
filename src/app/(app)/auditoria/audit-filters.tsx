"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

export interface AuditFilterValues {
  entidade?: string;
  de?: string;
  ate?: string;
}

/** GET form: filters live in the URL, so pagination keeps them and links can be shared. */
export function AuditFilters({ values, entities }: { values: AuditFilterValues; entities: { value: string; label: string }[] }) {
  const filtered = Boolean(values.entidade || values.de || values.ate);
  return (
    <Form
      action="/auditoria"
      role="search"
      aria-label="Filtrar eventos de auditoria"
      className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4"
    >
      <Field label="Entidade" className="min-w-44 flex-1">
        {(props) => (
          <Select {...props} name="entidade" defaultValue={values.entidade ?? ""}>
            <option value="">Todas</option>
            {entities.map((entity) => (
              <option key={entity.value} value={entity.value}>
                {entity.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="De" className="min-w-40 flex-1">
        {(props) => <Input {...props} type="date" name="de" defaultValue={values.de ?? ""} />}
      </Field>
      <Field label="Até" className="min-w-40 flex-1">
        {(props) => <Input {...props} type="date" name="ate" defaultValue={values.ate ?? ""} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="secondary">
          <Search className="size-4" aria-hidden /> Filtrar
        </Button>
        {filtered ? (
          <LinkButton href="/auditoria" variant="ghost">
            Limpar
          </LinkButton>
        ) : null}
      </div>
    </Form>
  );
}
