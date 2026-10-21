"use client";

import { Pencil, Power, PowerOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { CatalogOption } from "@/server/catalog/options";
import { setProductActiveAction, updateProductAction } from "../actions";

export interface ProductValues {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  categoryId: string | null;
  brandId: string | null;
  supplierId: string | null;
}

export interface ProductOptions {
  categories: CatalogOption[];
  brands: CatalogOption[];
  suppliers: CatalogOption[];
}

function FormActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      {children}
    </div>
  );
}

function ReferenceSelect(props: {
  label: string;
  name: string;
  value: string | null;
  empty: string;
  inactiveSuffix: string;
  options: CatalogOption[];
  error?: string[];
}) {
  return (
    <Field label={props.label} error={props.error}>
      {(field) => (
        <Select {...field} name={props.name} defaultValue={props.value ?? ""}>
          <option value="">{props.empty}</option>
          {props.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.isActive ? option.name : `${option.name} ${props.inactiveSuffix}`}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

// Rendered inside the dialog content, so each opening starts with a fresh form state.
function ProductForm({ product, options, onDone }: { product: ProductValues; options: ProductOptions; onDone: () => void }) {
  const [state, action] = useFormAction(updateProductAction, onDone);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="productId" value={product.id} />
      <Field label="Nome" error={errors.name} required>
        {(props) => <Input {...props} name="name" defaultValue={product.name} maxLength={120} autoComplete="off" required />}
      </Field>
      <Field label="Descrição" error={errors.description}>
        {(props) => <Textarea {...props} name="description" defaultValue={product.description ?? ""} maxLength={1000} />}
      </Field>
      <ReferenceSelect label="Categoria" name="categoryId" value={product.categoryId} empty="Nenhuma" inactiveSuffix="(inativa)" options={options.categories} error={errors.categoryId} />
      <ReferenceSelect label="Marca" name="brandId" value={product.brandId} empty="Nenhuma" inactiveSuffix="(inativa)" options={options.brands} error={errors.brandId} />
      <ReferenceSelect label="Fornecedor" name="supplierId" value={product.supplierId} empty="Nenhum" inactiveSuffix="(inativo)" options={options.suppliers} error={errors.supplierId} />
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function ProductEditDialog({ product, options }: { product: ProductValues; options: ProductOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Editar produto"
      description="A unidade é definida no cadastro e não muda."
      trigger={
        <Button variant="secondary">
          <Pencil className="size-4" aria-hidden /> Editar produto
        </Button>
      }
    >
      <ProductForm product={product} options={options} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function StatusForm({ product, onDone }: { product: ProductValues; onDone: () => void }) {
  const [state, action] = useFormAction(setProductActiveAction, onDone);
  const activating = !product.isActive;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={product.id} />
      <input type="hidden" name="active" value={activating ? "true" : "false"} />
      <FormActions onCancel={onDone}>
        <SubmitButton variant={activating ? "primary" : "danger"} pendingLabel={activating ? "Ativando…" : "Desativando…"}>
          {activating ? "Ativar produto" : "Desativar produto"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function ProductStatusDialog({ product }: { product: ProductValues }) {
  const [open, setOpen] = useState(false);
  const activating = !product.isActive;
  const Icon = activating ? Power : PowerOff;
  const verb = activating ? "Ativar" : "Desativar";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${verb} o produto ${product.name}?`}
      description={activating ? "O produto volta a constar como ativo." : "O produto deixa de aparecer para venda; o histórico é mantido."}
      trigger={
        <Button variant="ghost" aria-label={`${verb} produto ${product.name}`}>
          <Icon className="size-4" aria-hidden /> {verb} produto
        </Button>
      }
    >
      <StatusForm product={product} onDone={() => setOpen(false)} />
    </Dialog>
  );
}
