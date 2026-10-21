// Pure status parameter conversion for the catalog reference lists.

export type CatalogStatus = "active" | "inactive";

/** "ativo" -> "active", "inativo" -> "inactive"; anything else (including arrays and undefined) -> undefined. */
export function parseStatusParam(value: unknown): CatalogStatus | undefined {
  if (value === "ativo") return "active";
  if (value === "inativo") return "inactive";
  return undefined;
}

/** "active" -> "ativo", "inactive" -> "inativo", undefined -> "". */
export function statusToParam(status: CatalogStatus | undefined): "ativo" | "inativo" | "" {
  if (status === "active") return "ativo";
  if (status === "inactive") return "inativo";
  return "";
}
