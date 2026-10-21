"use client";

import { Notice } from "@/components/ui/feedback";
import { Field, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { openCountAction } from "../actions";

interface Option {
  id: string;
  name: string;
}

export function OpenCountForm({
  stores,
  categories,
  brands,
  defaultStoreId,
}: {
  stores: (Option & { code: string })[];
  categories: Option[];
  brands: Option[];
  defaultStoreId: string;
}) {
  // On success the action redirects to the new count.
  const [state, action] = useFormAction(openCountAction);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Loja" error={errors.storeId} required>
          {(props) => (
            <Select {...props} name="storeId" defaultValue={defaultStoreId} required>
              {defaultStoreId ? null : <option value="">Selecione</option>}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.code} · {store.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Categoria" hint="Opcional." error={errors.categoryId}>
          {(props) => (
            <Select {...props} name="categoryId" defaultValue="" disabled={categories.length === 0}>
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Marca" hint="Opcional." error={errors.brandId}>
          {(props) => (
            <Select {...props} name="brandId" defaultValue="" disabled={brands.length === 0}>
              <option value="">Todas</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Observação" hint="Opcional, até 500 caracteres." error={errors.note}>
        {(props) => <Textarea {...props} name="note" maxLength={500} />}
      </Field>
      <Notice tone="info" title="Só um inventário por vez em cada loja.">
        Enquanto estiver aberto, as vendas e movimentações continuam; a aprovação ajusta pelo saldo do momento da aprovação.
      </Notice>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Abrindo…">Abrir inventário</SubmitButton>
      </div>
    </form>
  );
}
