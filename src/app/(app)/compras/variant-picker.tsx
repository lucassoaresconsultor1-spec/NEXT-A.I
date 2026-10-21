"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { searchVariantsAction } from "./actions";

export interface PickedVariant {
  variantId: string;
  label: string;
  sku: string;
  unit: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

/** Product search for the order form: keyboard listbox over active variants (no costs). */
export function VariantPicker({ selectedIds, onPick }: { selectedIds: readonly string[]; onPick: (variant: PickedVariant) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedVariant[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, startTransition] = useTransition();
  const latest = useRef("");

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_CHARS) return;
    const timer = setTimeout(() => {
      latest.current = term;
      startTransition(async () => {
        const hits = await searchVariantsAction(term);
        // Ignore answers to a query the member already changed.
        if (latest.current !== term) return;
        setResults(hits);
        setActive(hits.length > 0 ? 0 : -1);
        setOpen(true);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const isTaken = (variant: PickedVariant) => selectedIds.includes(variant.variantId);

  function choose(index: number) {
    const variant = results[index];
    if (!variant || isTaken(variant)) return;
    onPick(variant);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActive((current) => (current <= 0 ? results.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      // Never submit the order form from the search field.
      event.preventDefault();
      if (open && active >= 0) choose(active);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= MIN_CHARS;

  return (
    <div className="relative space-y-1.5">
      <label htmlFor={`${id}-input`} className="block text-sm font-medium text-ink">
        Buscar produto
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <Input
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-describedby={`${id}-hint`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length < MIN_CHARS) setOpen(false);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          maxLength={80}
          autoComplete="off"
          className="pl-9"
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-ink-muted">
        Nome, SKU ou código de barras, a partir de 2 caracteres.
      </p>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Produtos encontrados"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-[var(--shadow-card)]"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted" role="presentation">
              {pending ? "Buscando…" : "Nenhum produto ativo encontrado."}
            </li>
          ) : (
            results.map((variant, index) => {
              const taken = isTaken(variant);
              return (
                <li
                  key={variant.variantId}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={taken}
                  // mousedown keeps the focus on the input until the choice is made.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(index);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm",
                    index === active ? "bg-brand-soft" : "",
                    taken ? "cursor-not-allowed text-ink-muted" : "text-ink",
                  )}
                >
                  <span className="font-medium">{variant.label}</span>
                  <span className="block text-xs text-ink-muted">
                    {variant.sku} · {variant.unit}
                    {taken ? " · Já está no pedido" : ""}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
