"use client";

import { Trash2 } from "lucide-react";
import { startTransition, useRef, useState, type FormEvent } from "react";
import { VariantPicker, type PickedVariant } from "@/app/(app)/compras/variant-picker";
import { Button, LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useFormAction } from "@/components/ui/use-form-action";
import { MAX_TRANSFER_ITEMS } from "@/server/inventory/transfer-schemas";
import { requestTransferAction } from "../actions";

interface StoreChoice {
  id: string;
  code: string;
  name: string;
}

interface ItemRow extends PickedVariant {
  key: number;
  quantity: string;
}

export function TransferForm({
  originStores,
  destinationStores,
  partialScope,
}: {
  originStores: StoreChoice[];
  destinationStores: StoreChoice[];
  partialScope: boolean;
}) {
  const [state, action] = useFormAction(requestTransferAction);
  const [items, setItems] = useState<ItemRow[]>([]);
  const nextKey = useRef(0);
  const errors = state.fieldErrors ?? {};
  const atLimit = items.length >= MAX_TRANSFER_ITEMS;

  // Keep what the member typed when the server answers with errors.
  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  const storeOptions = (stores: StoreChoice[]) =>
    stores.map((store) => (
      <option key={store.id} value={store.id}>
        {store.code} · {store.name}
      </option>
    ));

  return (
    <form action={action} onSubmit={submitKeepingValues} className="space-y-6" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <Card>
        <CardHeader title="Transferência" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Loja de origem"
            hint={partialScope ? "Para pedir de uma loja fora do seu acesso, fale com o coordenador." : "Loja que envia as mercadorias."}
            error={errors.originStoreId}
            required
          >
            {(props) => (
              <Select {...props} name="originStoreId" defaultValue="" required>
                <option value="">Selecione</option>
                {storeOptions(originStores)}
              </Select>
            )}
          </Field>
          <Field label="Loja de destino" hint="Loja que recebe as mercadorias." error={errors.destinationStoreId} required>
            {(props) => (
              <Select {...props} name="destinationStoreId" defaultValue="" required>
                <option value="">Selecione</option>
                {storeOptions(destinationStores)}
              </Select>
            )}
          </Field>
          <Field label="Observações" error={errors.notes} className="sm:col-span-2">
            {(props) => <Textarea {...props} name="notes" maxLength={500} />}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Itens" description="Até 200 itens. A origem confere o saldo ao aprovar." />
        <CardBody className="space-y-4">
          {errors.items ? <Notice tone="error" title={errors.items[0]} /> : null}
          {atLimit ? (
            <p className="text-sm text-ink-muted">Limite de 200 itens por transferência.</p>
          ) : (
            <VariantPicker
              selectedIds={items.map((item) => item.variantId)}
              onPick={(variant) => setItems((current) => [...current, { ...variant, key: nextKey.current++, quantity: "" }])}
            />
          )}
          {items.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum item. Busque um produto para incluir.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Itens da transferência">
                <thead>
                  <tr>
                    <Th>Produto</Th>
                    <Th>Quantidade</Th>
                    <Th className="text-right">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const prefix = `items.${index}.`;
                    return (
                      <Tr key={item.key}>
                        <Td>
                          <input type="hidden" name={`${prefix}variantId`} value={item.variantId} />
                          <span className="font-medium">{item.label}</span>
                          <span className="block text-xs text-ink-muted">{item.sku}</span>
                          {errors[`${prefix}variantId`] ? <span className="block text-xs font-medium text-critical">{errors[`${prefix}variantId`][0]}</span> : null}
                        </Td>
                        <Td className="min-w-40">
                          <Field
                            label={`Quantidade de ${item.label}`}
                            hint={item.unit === "un" ? "Somente números inteiros." : undefined}
                            error={errors[`${prefix}quantity`]}
                            className="[&>label]:sr-only"
                          >
                            {(props) => (
                              <Input
                                {...props}
                                name={`${prefix}quantity`}
                                value={item.quantity}
                                onChange={(event) =>
                                  setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, quantity: event.target.value } : entry)))
                                }
                                inputMode="decimal"
                                maxLength={16}
                                autoComplete="off"
                              />
                            )}
                          </Field>
                        </Td>
                        <Td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                            aria-label={`Remover ${item.label} da transferência`}
                          >
                            <Trash2 className="size-4" aria-hidden /> Remover
                          </Button>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <LinkButton href="/estoque/transferencias" variant="secondary">
          Cancelar
        </LinkButton>
        <SubmitButton pendingLabel="Solicitando…">Solicitar transferência</SubmitButton>
      </div>
    </form>
  );
}
