"use client";

import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/form";
import type { StoreAccessValue } from "./member-badges";

export interface ScopeOptions {
  /** Only organization-wide viewers may grant "all" or region-based access. */
  organizationWide: boolean;
  regions: { id: string; name: string }[];
  stores: { id: string; code: string; name: string; status: "active" | "inactive" }[];
}

export interface ScopeValues {
  storeAccess: StoreAccessValue;
  regionIds: string[];
  storeIds: string[];
}

interface Choice {
  value: StoreAccessValue;
  label: string;
  hint: string;
  disabled?: boolean;
}

function choicesFor(options: ScopeOptions): Choice[] {
  const choices: Choice[] = [];
  if (options.organizationWide) {
    choices.push(
      { value: "all", label: "Todas as lojas", hint: "Acesso a todas as lojas da empresa, inclusive as que forem cadastradas depois." },
      {
        value: "regions",
        label: "Regiões",
        hint: options.regions.length
          ? "Lojas das regiões selecionadas, inclusive as que entrarem nelas depois."
          : "Cadastre regiões para usar esta opção.",
        disabled: options.regions.length === 0,
      },
    );
  }
  choices.push({ value: "stores", label: "Lojas específicas", hint: "Somente as lojas selecionadas." });
  return choices;
}

function ErrorText({ id, error }: { id?: string; error?: string[] }) {
  return error?.length ? (
    <p id={id} className="text-xs font-medium text-critical">
      {error[0]}
    </p>
  ) : null;
}

/** Checkbox list kept in the DOM while hidden (selection survives toggling) but disabled so it is not submitted. */
function ChoiceList({
  legend,
  name,
  hidden,
  items,
  defaults,
  error,
  empty,
}: {
  legend: string;
  name: string;
  hidden: boolean;
  items: { id: string; label: string }[];
  defaults: string[];
  error?: string[];
  empty: string;
}) {
  const errorId = useId();
  return (
    <fieldset
      hidden={hidden}
      disabled={hidden}
      aria-describedby={error?.length ? errorId : undefined}
      className="space-y-2 rounded-md border border-line p-3"
    >
      <legend className="px-1 text-sm font-medium text-ink">{legend}</legend>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
          {items.map((item) => (
            <Checkbox key={item.id} name={name} value={item.id} defaultChecked={defaults.includes(item.id)} label={item.label} />
          ))}
        </div>
      )}
      <ErrorText id={errorId} error={error} />
    </fieldset>
  );
}

/**
 * Scope radio group plus the region/store lists. The list shown follows the
 * chosen mode; the server validates every id and rule again.
 */
export function MemberScopeFields({
  options,
  defaults,
  errors,
}: {
  options: ScopeOptions;
  defaults: ScopeValues;
  errors?: Record<string, string[]>;
}) {
  const choices = choicesFor(options);
  const initial = choices.some((choice) => choice.value === defaults.storeAccess && !choice.disabled) ? defaults.storeAccess : "stores";
  const [access, setAccess] = useState<StoreAccessValue>(initial);
  const errorId = useId();
  return (
    <fieldset className="space-y-3" aria-describedby={errors?.storeAccess?.length ? errorId : undefined}>
      <legend className="text-sm font-medium text-ink">
        Escopo de acesso<span className="text-critical" aria-hidden> *</span>
      </legend>
      <div className="space-y-2">
        {choices.map((choice) => (
          <label key={choice.value} className="flex items-start gap-2 text-sm text-ink has-[:disabled]:text-ink-muted">
            <input
              type="radio"
              name="storeAccess"
              value={choice.value}
              checked={access === choice.value}
              disabled={choice.disabled}
              onChange={() => setAccess(choice.value)}
              className="mt-0.5 size-4 accent-brand"
            />
            <span>
              <span className="font-medium">{choice.label}</span>
              <span className="block text-xs text-ink-muted">{choice.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <ErrorText id={errorId} error={errors?.storeAccess} />
      {options.organizationWide ? (
        <ChoiceList
          legend="Regiões"
          name="regionIds"
          hidden={access !== "regions"}
          items={options.regions.map((region) => ({ id: region.id, label: region.name }))}
          defaults={defaults.regionIds}
          error={errors?.regionIds}
          empty="Nenhuma região cadastrada."
        />
      ) : null}
      <ChoiceList
        legend="Lojas"
        name="storeIds"
        hidden={access !== "stores"}
        items={options.stores.map((store) => ({
          id: store.id,
          label: `${store.name} (${store.code})${store.status === "inactive" ? " · inativa" : ""}`,
        }))}
        defaults={defaults.storeIds}
        error={errors?.storeIds}
        empty="Nenhuma loja no seu escopo."
      />
    </fieldset>
  );
}
