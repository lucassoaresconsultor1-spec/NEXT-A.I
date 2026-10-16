"use client";

import type { ReactNode } from "react";
import { Field, Input, Select } from "@/components/ui/form";
import { BRAZIL_STATES, BRAZIL_TIMEZONES } from "@/lib/brazil";
import { formatCep, formatCnpj, formatPhone } from "@/lib/documents";
import { inheritedTimezoneLabel } from "./store-labels";

export interface StoreFormValues {
  id: string;
  code: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  regionId: string | null;
  regionName: string | null;
}

/** Region select: editable options, or locked with the reason shown as a hint. */
export type RegionChoice = { locked: false; options: { id: string; name: string }[] } | { locked: true; reason: string };

type Errors = Record<string, string[]> | undefined;

interface SectionProps {
  store?: StoreFormValues;
  errors: Errors;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <fieldset className="border-b border-line px-5 py-5 last:border-b-0">
      <legend className="float-left w-full">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
      </legend>
      <div className="clear-both grid gap-4 pt-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function IdentificationSection({ store, errors }: SectionProps) {
  return (
    <Section title="Identificação" description="Como a loja aparece nos relatórios, seletores e documentos.">
      <Field label="Código" required error={errors?.code} hint="Até 16 caracteres: letras sem acento, números e hífen. Ex.: SP-01.">
        {(props) => (
          <Input
            {...props}
            name="code"
            defaultValue={store?.code ?? ""}
            maxLength={16}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="uppercase"
            required
          />
        )}
      </Field>
      <Field label="Nome" required error={errors?.name}>
        {(props) => <Input {...props} name="name" defaultValue={store?.name ?? ""} maxLength={120} autoComplete="off" required />}
      </Field>
      <Field label="CNPJ" error={errors?.document} hint="Opcional. Aceita CNPJ numérico ou alfanumérico.">
        {(props) => (
          <Input
            {...props}
            name="document"
            defaultValue={store?.document ? formatCnpj(store.document) : ""}
            maxLength={18}
            autoComplete="off"
            spellCheck={false}
            placeholder="00.000.000/0000-00"
          />
        )}
      </Field>
    </Section>
  );
}

export function ContactSection({ store, errors }: SectionProps) {
  return (
    <Section title="Contato" description="Canais de contato da própria loja.">
      <Field label="Telefone" error={errors?.phone} hint="DDD + número.">
        {(props) => (
          <Input
            {...props}
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={store?.phone ? formatPhone(store.phone) : ""}
            maxLength={16}
            autoComplete="off"
            placeholder="(11) 3333-4444"
          />
        )}
      </Field>
      <Field label="E-mail" error={errors?.email}>
        {(props) => (
          <Input {...props} name="email" type="email" defaultValue={store?.email ?? ""} maxLength={254} autoComplete="off" />
        )}
      </Field>
    </Section>
  );
}

export function AddressSection({ store, errors }: SectionProps) {
  return (
    <Section title="Endereço" description="Endereço físico de atendimento.">
      <Field label="CEP" error={errors?.postalCode}>
        {(props) => (
          <Input
            {...props}
            name="postalCode"
            inputMode="numeric"
            defaultValue={store?.postalCode ? formatCep(store.postalCode) : ""}
            maxLength={9}
            autoComplete="off"
            placeholder="00000-000"
          />
        )}
      </Field>
      <Field label="Logradouro" error={errors?.street}>
        {(props) => <Input {...props} name="street" defaultValue={store?.street ?? ""} maxLength={160} autoComplete="off" />}
      </Field>
      <Field label="Número" error={errors?.number}>
        {(props) => <Input {...props} name="number" defaultValue={store?.number ?? ""} maxLength={16} autoComplete="off" />}
      </Field>
      <Field label="Complemento" error={errors?.complement}>
        {(props) => <Input {...props} name="complement" defaultValue={store?.complement ?? ""} maxLength={80} autoComplete="off" />}
      </Field>
      <Field label="Bairro" error={errors?.district}>
        {(props) => <Input {...props} name="district" defaultValue={store?.district ?? ""} maxLength={80} autoComplete="off" />}
      </Field>
      <Field label="Cidade" error={errors?.city}>
        {(props) => <Input {...props} name="city" defaultValue={store?.city ?? ""} maxLength={80} autoComplete="off" />}
      </Field>
      <Field label="UF" error={errors?.state}>
        {(props) => (
          <Select {...props} name="state" defaultValue={store?.state ?? ""}>
            <option value="">Selecione</option>
            {BRAZIL_STATES.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Section>
  );
}

export function OperationSection({
  store,
  errors,
  regions,
  organizationTimezone,
}: SectionProps & { regions: RegionChoice; organizationTimezone: string }) {
  const options = regions.locked ? [] : [...regions.options];
  if (!regions.locked && store?.regionId && store.regionName && !options.some((option) => option.id === store.regionId)) {
    options.push({ id: store.regionId, name: store.regionName });
  }
  return (
    <Section title="Operação" description="Região usada na consolidação de resultados e fuso horário dos registros da loja.">
      <Field label="Região" error={errors?.regionId} hint={regions.locked ? regions.reason : undefined}>
        {(props) =>
          regions.locked ? (
            // Disabled controls are not submitted, so the current region is kept.
            <Select {...props} defaultValue={store?.regionId ?? ""} disabled>
              <option value={store?.regionId ?? ""}>{store?.regionName ?? "Sem região"}</option>
            </Select>
          ) : (
            <Select {...props} name="regionId" defaultValue={store?.regionId ?? ""}>
              <option value="">Sem região</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          )
        }
      </Field>
      <Field label="Fuso horário" error={errors?.timezone} hint="Sem escolha, a loja segue o fuso da empresa.">
        {(props) => (
          <Select {...props} name="timezone" defaultValue={store?.timezone ?? ""}>
            <option value="">{inheritedTimezoneLabel(organizationTimezone)}</option>
            {BRAZIL_TIMEZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Section>
  );
}
