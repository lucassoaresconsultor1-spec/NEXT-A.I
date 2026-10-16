"use client";

import { useTransition } from "react";
import { selectStoreAction } from "@/app/session-actions";

/** Persists the selected store in the server-side session (validated against the member's scope). */
export function StoreSwitcher({
  stores,
  activeStoreId,
}: {
  stores: { id: string; code: string; name: string }[];
  activeStoreId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  if (stores.length === 0) return null;
  return (
    <form className="hidden md:block">
      <label htmlFor="active-store" className="sr-only">
        Loja selecionada
      </label>
      <select
        id="active-store"
        name="storeId"
        defaultValue={activeStoreId ?? ""}
        disabled={pending}
        onChange={(event) => {
          const data = new FormData();
          data.set("storeId", event.currentTarget.value);
          startTransition(() => selectStoreAction(data));
        }}
        className="h-9 max-w-56 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink"
      >
        <option value="">Todas as lojas</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.code} · {store.name}
          </option>
        ))}
      </select>
    </form>
  );
}
