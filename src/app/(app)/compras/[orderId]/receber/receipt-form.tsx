"use client";

import { startTransition, useState, type FormEvent } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatQuantity, type QuantityUnit } from "@/lib/quantity-format";
import { receiveGoodsAction } from "../../actions";

export interface ReceiptLine {
  orderItemId: string;
  label: string;
  sku: string;
  unit: QuantityUnit;
  /** Pending quantity as the database returns it ("2.500"). */
  pending: string;
}

/** "1234.500" -> "1234,5": form input without thousands separators. */
function quantityInput(dbValue: string) {
  const [whole, fraction = ""] = dbValue.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole},${trimmed}` : whole;
}

export function ReceiptForm({ orderId, number, idempotencyKey, lines }: { orderId: string; number: number; idempotencyKey: string; lines: ReceiptLine[] }) {
  const [state, action] = useFormAction(receiveGoodsAction);
  const [quantities, setQuantities] = useState<string[]>(() => lines.map(() => ""));
  const errors = state.fieldErrors ?? {};

  // Keep typed quantities on errors; the same idempotency key travels on every resubmission.
  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form action={action} onSubmit={submitKeepingValues} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={errors.items?.[0] ?? state.message} /> : null}
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setQuantities(lines.map((line) => quantityInput(line.pending)))}>
          Receber tudo
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table caption={`Itens pendentes do pedido nº ${number}`}>
          <thead>
            <tr>
              <Th>Produto</Th>
              <Th className="text-right">Pendente</Th>
              <Th>Quantidade recebida</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <Tr key={line.orderItemId}>
                <Td>
                  <input type="hidden" name={`items.${index}.orderItemId`} value={line.orderItemId} />
                  <span className="font-medium">{line.label}</span>
                  <span className="block text-xs text-ink-muted">{line.sku}</span>
                </Td>
                <Td className="text-right tabular-nums">{formatQuantity(line.pending, line.unit)}</Td>
                <Td className="min-w-40">
                  <Field
                    label={`Quantidade recebida de ${line.label}`}
                    hint={line.unit === "un" ? "Somente números inteiros." : undefined}
                    error={errors[`items.${index}.quantity`] ?? errors[`items.${index}.orderItemId`]}
                    className="[&>label]:sr-only"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        name={`items.${index}.quantity`}
                        value={quantities[index]}
                        onChange={(event) => setQuantities((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
                        inputMode="decimal"
                        maxLength={16}
                        autoComplete="off"
                      />
                    )}
                  </Field>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Field label="Observações" hint="Opcional, até 500 caracteres." error={errors.notes}>
        {(props) => <Textarea {...props} name="notes" maxLength={500} />}
      </Field>
      <div className="flex justify-end gap-2">
        <LinkButton href={`/compras/${orderId}`} variant="secondary">
          Cancelar
        </LinkButton>
        <SubmitButton pendingLabel="Registrando…">Registrar recebimento</SubmitButton>
      </div>
    </form>
  );
}
