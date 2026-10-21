"use client";

import { Plus, Trash2 } from "lucide-react";
import { startTransition, useRef, useState, type FormEvent } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { useFormAction } from "@/components/ui/use-form-action";
import type { CatalogOption } from "@/server/catalog/options";
import { MAX_VARIANTS_PER_PRODUCT, PRODUCT_UNITS } from "@/server/catalog/schemas";
import { createProductAction } from "../actions";
import { PRODUCT_UNIT_LABELS } from "../variant-form-data";

interface Options {
  categories: CatalogOption[];
  brands: CatalogOption[];
  suppliers: CatalogOption[];
}

function ReferenceSelect({
  label,
  name,
  empty,
  options,
  error,
}: {
  label: string;
  name: string;
  empty: string;
  options: CatalogOption[];
  error?: string[];
}) {
  return (
    <Field label={label} error={error}>
      {(props) => (
        <Select {...props} name={name} defaultValue="">
          <option value="">{empty}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Money input in reais with a visual "R$" prefix; the server converts it to cents. */
function MoneyInput(props: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted" aria-hidden>
        R$
      </span>
      <Input {...props} inputMode="decimal" maxLength={18} autoComplete="off" className="pl-10" />
    </div>
  );
}

export function NewProductForm({ options, canManageCosts }: { options: Options; canManageCosts: boolean }) {
  const [state, action] = useFormAction(createProductAction);
  // Stable keys: removing a row must not shift what the member typed in the others.
  const [rows, setRows] = useState<number[]>([0]);
  const nextKey = useRef(1);
  const list = useRef<HTMLDivElement>(null);
  const errors = state.fieldErrors ?? {};
  const atLimit = rows.length >= MAX_VARIANTS_PER_PRODUCT;
  const sectionErrors = ["variants", "sku", "barcode"].flatMap((key) => errors[key] ?? []);

  // A long form: keep what the member typed when the server answers with errors.
  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  function addRow() {
    if (atLimit) return;
    setRows((current) => [...current, nextKey.current++]);
    // Focus the name of the new row once it renders.
    requestAnimationFrame(() => {
      const inputs = list.current?.querySelectorAll<HTMLInputElement>("input[data-variant-name]");
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  return (
    <form action={action} onSubmit={submitKeepingValues} className="space-y-6" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <Card>
        <CardHeader title="Produto" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" error={errors.name} required className="sm:col-span-2">
            {(props) => <Input {...props} name="name" maxLength={120} autoComplete="off" required />}
          </Field>
          <Field label="Descrição" error={errors.description} className="sm:col-span-2">
            {(props) => <Textarea {...props} name="description" maxLength={1000} />}
          </Field>
          <Field label="Unidade" hint="Não pode ser alterada depois do cadastro." error={errors.unit} required>
            {(props) => (
              <Select {...props} name="unit" defaultValue="un" required>
                {PRODUCT_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {PRODUCT_UNIT_LABELS[unit]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ReferenceSelect label="Categoria" name="categoryId" empty="Nenhuma" options={options.categories} error={errors.categoryId} />
          <ReferenceSelect label="Marca" name="brandId" empty="Nenhuma" options={options.brands} error={errors.brandId} />
          <ReferenceSelect label="Fornecedor" name="supplierId" empty="Nenhum" options={options.suppliers} error={errors.supplierId} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Variações"
          description="Cada variação é vendida e estocada separadamente. Produto simples tem uma só."
          actions={
            <Button variant="secondary" size="sm" onClick={addRow} disabled={atLimit} aria-disabled={atLimit}>
              <Plus className="size-4" aria-hidden /> Adicionar variação
            </Button>
          }
        />
        <CardBody className="space-y-4">
          {sectionErrors.length > 0 ? <Notice tone="error" title={sectionErrors[0]} /> : null}
          {atLimit ? <p className="text-sm text-ink-muted">Limite de 50 variações por produto.</p> : null}
          <div ref={list} className="space-y-4">
            {rows.map((key, index) => {
              const prefix = `variants.${index}.`;
              return (
                <fieldset key={key} className="grid gap-3 rounded-md border border-line p-4 sm:grid-cols-2 lg:grid-cols-6">
                  <legend className="px-1 text-sm font-medium text-ink">Variação {index + 1}</legend>
                  <Field label="Nome" hint="Ex.: Único, 39, Azul P" error={errors[`${prefix}name`]} required className="lg:col-span-2">
                    {(props) => <Input {...props} name={`${prefix}name`} maxLength={80} autoComplete="off" required data-variant-name />}
                  </Field>
                  <Field label="SKU" hint="Letras sem acento, números, ponto, hífen ou sublinhado." error={errors[`${prefix}sku`]} required className="lg:col-span-2">
                    {(props) => <Input {...props} name={`${prefix}sku`} maxLength={40} autoComplete="off" autoCapitalize="characters" required />}
                  </Field>
                  <Field label="Código de barras" error={errors[`${prefix}barcode`]} className="lg:col-span-2">
                    {(props) => <Input {...props} name={`${prefix}barcode`} inputMode="numeric" maxLength={14} autoComplete="off" />}
                  </Field>
                  <Field label="Preço de venda" error={errors[`${prefix}price`] ?? errors[`${prefix}priceCents`]} className="lg:col-span-2">
                    {(props) => <MoneyInput {...props} name={`${prefix}price`} />}
                  </Field>
                  {canManageCosts ? (
                    <Field label="Custo" error={errors[`${prefix}cost`] ?? errors[`${prefix}costCents`]} className="lg:col-span-2">
                      {(props) => <MoneyInput {...props} name={`${prefix}cost`} />}
                    </Field>
                  ) : null}
                  <div className="flex items-end lg:col-span-2">
                    {rows.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((current) => current.filter((entry) => entry !== key))}
                        aria-label={`Remover variação ${index + 1}`}
                      >
                        <Trash2 className="size-4" aria-hidden /> Remover
                      </Button>
                    ) : null}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <LinkButton href="/produtos" variant="secondary">
          Cancelar
        </LinkButton>
        <SubmitButton pendingLabel="Cadastrando…">Cadastrar produto</SubmitButton>
      </div>
    </form>
  );
}
