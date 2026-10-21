import { z } from "zod";
import { parsePage } from "@/server/pagination";

// Pure definitions of the CSV imports: kinds, fields, header auto-mapping and the
// request validation. Row values are validated by the services' own schemas (preview.ts).

export const IMPORT_KINDS = ["products", "customers", "opening_stock"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  products: "Produtos",
  customers: "Clientes",
  opening_stock: "Saldo inicial de estoque",
};

export const IMPORT_STATUSES = ["previewed", "applying", "done", "discarded"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  previewed: "Prévia",
  applying: "Gravando",
  done: "Concluída",
  discarded: "Descartada",
};

export const ROW_STATUSES = ["ok", "error", "skipped", "applied", "failed"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];
export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  ok: "Válida",
  error: "Com erro",
  skipped: "Ignorada (repetida no arquivo)",
  applied: "Gravada",
  failed: "Falhou ao gravar",
};

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  /** Header names recognized automatically (compared without accents, case or spaces). */
  aliases: string[];
}

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  products: [
    { key: "productName", label: "Nome do produto", required: true, aliases: ["produto", "nome", "nome do produto", "descricao do produto"] },
    { key: "variantName", label: "Variação", required: false, aliases: ["variacao", "variante", "tamanho", "cor"] },
    { key: "sku", label: "SKU", required: true, aliases: ["sku", "codigo", "referencia", "ref"] },
    { key: "barcode", label: "Código de barras", required: false, aliases: ["codigo de barras", "ean", "gtin", "barras"] },
    { key: "unit", label: "Unidade", required: false, aliases: ["unidade", "un", "und"] },
    { key: "price", label: "Preço de venda", required: false, aliases: ["preco", "preco de venda", "valor", "preco venda"] },
    { key: "category", label: "Categoria", required: false, aliases: ["categoria", "grupo"] },
    { key: "brand", label: "Marca", required: false, aliases: ["marca", "fabricante"] },
    { key: "description", label: "Descrição", required: false, aliases: ["descricao", "observacao"] },
  ],
  customers: [
    { key: "name", label: "Nome", required: true, aliases: ["nome", "cliente", "nome do cliente", "nome completo"] },
    { key: "document", label: "CPF", required: false, aliases: ["cpf", "documento"] },
    { key: "email", label: "E-mail", required: false, aliases: ["email", "e mail", "correio eletronico"] },
    { key: "phone", label: "Telefone", required: false, aliases: ["telefone", "celular", "fone", "whatsapp"] },
  ],
  opening_stock: [
    { key: "sku", label: "SKU", required: true, aliases: ["sku", "codigo", "referencia", "ref"] },
    { key: "quantity", label: "Quantidade", required: true, aliases: ["quantidade", "qtd", "qtde", "saldo", "estoque"] },
  ],
};

/** "Preço de Venda" -> "preco de venda". */
export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Proposed mapping field -> header, each header used at most once. */
export function autoMapping(kind: ImportKind, header: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS[kind]) {
    const match = header.find((column) => !used.has(column) && field.aliases.includes(normalizeHeader(column)));
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  return mapping;
}

export const createImportSchema = z
  .object({
    kind: z.enum(IMPORT_KINDS, { error: "Escolha o que importar." }),
    storeId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Selecione a loja." }).optional()),
    fileName: z.string().trim().min(1, { error: "Envie um arquivo CSV." }).max(200).transform((name) => name.replace(/[\u0000-\u001f]/g, "")),
    mapping: z.record(z.string(), z.string().trim().max(120)),
  })
  .superRefine((input, context) => {
    if (input.kind === "opening_stock" && !input.storeId) context.addIssue({ code: "custom", path: ["storeId"], message: "Selecione a loja do saldo inicial." });
    const fields = IMPORT_FIELDS[input.kind];
    const known = new Set(fields.map((field) => field.key));
    const used = new Set<string>();
    for (const [key, column] of Object.entries(input.mapping)) {
      if (!known.has(key)) context.addIssue({ code: "custom", path: ["mapping", key], message: "Campo desconhecido." });
      if (column && used.has(column)) context.addIssue({ code: "custom", path: ["mapping", key], message: "Esta coluna já foi usada em outro campo." });
      if (column) used.add(column);
    }
    for (const field of fields) {
      if (field.required && !input.mapping[field.key]) context.addIssue({ code: "custom", path: ["mapping", field.key], message: `Escolha a coluna de ${field.label}.` });
    }
  })
  .transform((input) => ({
    ...input,
    storeId: input.kind === "opening_stock" ? input.storeId : undefined,
    mapping: Object.fromEntries(Object.entries(input.mapping).filter(([, column]) => column !== "")),
  }));
export type CreateImportInput = z.input<typeof createImportSchema>;

export const importFiltersSchema = z.object({
  kind: z.enum(IMPORT_KINDS).optional().catch(undefined),
  status: z.enum(IMPORT_STATUSES).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type ImportFilters = z.output<typeof importFiltersSchema>;

export const importRowFiltersSchema = z.object({
  status: z.enum(ROW_STATUSES).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type ImportRowFilters = z.output<typeof importRowFiltersSchema>;
