"use client";

import { Trash2 } from "lucide-react";
import { startTransition, useRef, useState, type FormEvent } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatCurrencyCents } from "@/lib/format";
import { formatCentsInput, parseBrlToCents } from "@/lib/money";
import { parseQuantityInput, QUANTITY_SCALE } from "@/server/inventory/quantity";
import { MAX_ORDER_ITEMS } from "@/server/purchasing/schemas";
import { savePurchaseOrderAction } from "./actions";
import { VariantPicker, type PickedVariant } from "./variant-picker";

export interface OrderFormOrder {
  id: string;
  storeId: string;
  supplierId: string;
  expectedDate: string | null;
  notes: string | null;
  items: (PickedVariant & { quantity: string; unitCostCents: number })[];
}

interface Choice {
  id: string;
  name: string;
}

interface ItemRow extends PickedVariant {
  key: number;
  quantity: string;
  unitCost: string;
}

/** "1234.500" (database) -> "1234,5" (form input; no thousands separator, which the parser would read as decimal). */
function quantityInput(dbValue: string) {
  const [whole, fraction = ""] = dbValue.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole},${trimmed}` : whole;
}

/** Display-only estimate: cents × thousandths ÷ 1000, rounded down. The server computes the real total. */
function estimateCents(quantity: string, unitCost: string): number | null {
  const milli = parseQuantityInput(quantity);
  const cents = parseBrlToCents(unitCost);
  if (milli === null || cents === null || milli <= BigInt(0)) return null;
  return Number((BigInt(cents) * milli) / QUANTITY_SCALE);
}

export function OrderForm({ stores, suppliers, order }: { stores: (Choice & { code: string })[]; suppliers: Choice[]; order?: OrderFormOrder }) {
  const [state, action] = useFormAction(savePurchaseOrderAction);
  const nextKey = useRef(order?.items.length ?? 0);
  const [items, setItems] = useState<ItemRow[]>(
    (order?.items ?? []).map((item, index) => ({
      key: index,
      variantId: item.variantId,
      label: item.label,
      sku: item.sku,
      unit: item.unit,
      quantity: quantityInput(item.quantity),
      unitCost: formatCentsInput(item.unitCostCents),
    })),
  );
  const errors = state.fieldErrors ?? {};
  const atLimit = items.length >= MAX_ORDER_ITEMS;

  // A long form: keep what the member typed when the server answers with errors.
  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  function update(key: number, field: "quantity" | "unitCost", value: string) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, [field]: value } : item)));
  }

  return (
    <form action={action} onSubmit={submitKeepingValues} className="space-y-6" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {order ? <input type="hidden" name="orderId" value={order.id} /> : null}
      <Card>
        <CardHeader title="Pedido" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Loja de destino" error={errors.storeId} required>
            {(props) => (
              <Select {...props} name="storeId" defaultValue={order?.storeId ?? ""} required>
                <option value="">Selecione</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.code} · {store.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Fornecedor" error={errors.supplierId} required>
            {(props) => (
              <Select {...props} name="supplierId" defaultValue={order?.supplierId ?? ""} required>
                <option value="">Selecione</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Previsão de entrega" error={errors.expectedDate}>
            {(props) => <Input {...props} type="date" name="expectedDate" defaultValue={order?.expectedDate ?? ""} />}
          </Field>
          <Field label="Observações" error={errors.notes} className="sm:col-span-2">
            {(props) => <Textarea {...props} name="notes" maxLength={500} defaultValue={order?.notes ?? ""} />}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Itens" description="Até 200 itens. O subtotal é uma estimativa; o total oficial é calculado ao salvar." />
        <CardBody className="space-y-4">
          {errors.items ? <Notice tone="error" title={errors.items[0]} /> : null}
          {atLimit ? (
            <p className="text-sm text-ink-muted">Limite de 200 itens por pedido.</p>
          ) : (
            <VariantPicker
              selectedIds={items.map((item) => item.variantId)}
              onPick={(variant) => setItems((current) => [...current, { ...variant, key: nextKey.current++, quantity: "", unitCost: "" }])}
            />
          )}
          {items.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum item no pedido. Busque um produto para incluir.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Itens do pedido">
                <thead>
                  <tr>
                    <Th>Produto</Th>
                    <Th>Quantidade</Th>
                    <Th>Custo unitário</Th>
                    <Th className="text-right">Subtotal</Th>
                    <Th className="text-right">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const prefix = `items.${index}.`;
                    const estimate = estimateCents(item.quantity, item.unitCost);
                    return (
                      <Tr key={item.key}>
                        <Td>
                          <input type="hidden" name={`${prefix}variantId`} value={item.variantId} />
                          <span className="font-medium">{item.label}</span>
                          <span className="block text-xs text-ink-muted">{item.sku}</span>
                          {errors[`${prefix}variantId`] ? <span className="block text-xs font-medium text-critical">{errors[`${prefix}variantId`][0]}</span> : null}
                        </Td>
                        <Td className="min-w-36">
                          <Field label={`Quantidade de ${item.label}`} hint={item.unit === "un" ? "Somente números inteiros." : undefined} error={errors[`${prefix}quantity`]} className="[&>label]:sr-only">
                            {(props) => (
                              <Input
                                {...props}
                                name={`${prefix}quantity`}
                                value={item.quantity}
                                onChange={(event) => update(item.key, "quantity", event.target.value)}
                                inputMode="decimal"
                                maxLength={16}
                                autoComplete="off"
                              />
                            )}
                          </Field>
                        </Td>
                        <Td className="min-w-40">
                          <Field label={`Custo unitário de ${item.label}`} error={errors[`${prefix}unitCostCents`]} className="[&>label]:sr-only">
                            {(props) => (
                              <Input
                                {...props}
                                name={`${prefix}unitCost`}
                                value={item.unitCost}
                                onChange={(event) => update(item.key, "unitCost", event.target.value)}
                                inputMode="decimal"
                                maxLength={18}
                                autoComplete="off"
                                placeholder="R$ 0,00"
                              />
                            )}
                          </Field>
                        </Td>
                        <Td className="text-right tabular-nums">
                          {estimate === null ? "—" : formatCurrencyCents(estimate)}
                          <span className="block text-xs text-ink-muted">Estimado</span>
                        </Td>
                        <Td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                            aria-label={`Remover ${item.label} do pedido`}
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
        <LinkButton href={order ? `/compras/${order.id}` : "/compras"} variant="secondary">
          Cancelar
        </LinkButton>
        <SubmitButton pendingLabel="Salvando…">{order ? "Salvar alterações" : "Criar pedido"}</SubmitButton>
      </div>
    </form>
  );
}
