import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { brands, categories, customers, importRows, inventoryMovements, products, productVariants } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { CsvRow } from "@/lib/csv";
import { parseBrlToCents } from "@/lib/money";
import { MAX_VARIANTS_PER_PRODUCT, newVariantSchema, productInputSchema } from "@/server/catalog/schemas";
import { customerInputSchema } from "@/server/customers/schemas";
import { toDbQuantity } from "@/server/inventory/quantity";
import { movementInputSchema } from "@/server/inventory/schemas";
import { IMPORT_FIELDS, normalizeHeader, type ImportKind } from "./schemas";

// Preview of a CSV import: every row is validated with the services' own Zod
// schemas plus the database checks (existing SKU/CPF, stock movements). Nothing
// is written here; the caller stores the result as import rows.

export type PreviewRow = Omit<typeof importRows.$inferInsert, "organizationId" | "importId">;

const OPENING_REASON = "Saldo inicial importado";
const CHUNK = 1000;

const PATH_LABELS: Record<string, string> = {
  name: "Nome",
  description: "Descrição",
  unit: "Unidade",
  sku: "SKU",
  barcode: "Código de barras",
  priceCents: "Preço de venda",
  document: "CPF",
  email: "E-mail",
  phone: "Telefone",
  quantity: "Quantidade",
};

function messagesOf(error: z.ZodError, prefix?: string) {
  return error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    const label = prefix && key === "name" ? prefix : PATH_LABELS[key];
    return (label ? `${label}: ${issue.message}` : issue.message).slice(0, 300);
  });
}

async function inChunks<T>(values: string[], load: (chunk: string[]) => Promise<T[]>) {
  const result: T[] = [];
  for (let start = 0; start < values.length; start += CHUNK) result.push(...(await load(values.slice(start, start + CHUNK))));
  return result;
}

function reader(header: string[], mapping: Record<string, string>) {
  const index = new Map(Object.entries(mapping).map(([field, column]) => [field, header.indexOf(column)]));
  return (row: CsvRow, field: string) => {
    const position = index.get(field);
    return position === undefined || position < 0 ? "" : (row.cells[position] ?? "");
  };
}

function base(row: CsvRow, header: string[]): PreviewRow {
  const messages = row.cells.length > header.length ? [`A linha tem ${row.cells.length} colunas; o cabeçalho tem ${header.length}.`] : [];
  return { line: row.line, status: messages.length ? "error" : "ok", messages };
}

const fail = (row: PreviewRow, ...messages: string[]) => {
  row.status = "error";
  row.messages = [...(row.messages ?? []), ...messages];
};

async function previewProducts(tx: Tx, orgId: string, header: string[], rows: CsvRow[], mapping: Record<string, string>) {
  const cell = reader(header, mapping);
  const named = async (table: typeof categories | typeof brands) => {
    const list = await tx.select({ id: table.id, name: table.name }).from(table).where(and(eq(table.organizationId, orgId), eq(table.isActive, true)));
    return new Map(list.map((entry) => [normalizeHeader(entry.name), entry.id]));
  };
  const categoryIds = await named(categories);
  const brandIds = await named(brands);
  const result = rows.map((row) => {
    const out = base(row, header);
    const priceText = cell(row, "price");
    const priceCents = priceText ? parseBrlToCents(priceText) : undefined;
    if (priceCents === null) fail(out, "Preço de venda: valor inválido. Use, por exemplo, 12,90.");
    const lookup = (field: string, ids: Map<string, string>, label: string) => {
      const name = cell(row, field);
      if (!name) return null;
      const id = ids.get(normalizeHeader(name));
      if (!id) fail(out, `${label}: "${name.slice(0, 80)}" não existe entre as ativas da empresa.`);
      return id ?? null;
    };
    const categoryId = lookup("category", categoryIds, "Categoria");
    const brandId = lookup("brand", brandIds, "Marca");
    const unitText = cell(row, "unit").toLowerCase();
    const product = productInputSchema.safeParse({ name: cell(row, "productName"), description: cell(row, "description"), unit: unitText || undefined, categoryId, brandId });
    const variant = newVariantSchema.safeParse({ name: cell(row, "variantName") || "Única", sku: cell(row, "sku"), barcode: cell(row, "barcode"), priceCents: priceCents ?? undefined });
    if (!product.success) fail(out, ...messagesOf(product.error, "Nome do produto"));
    if (!variant.success) fail(out, ...messagesOf(variant.error, "Variação"));
    if (product.success && variant.success) {
      Object.assign(out, {
        groupKey: normalizeHeader(product.data.name).slice(0, 120),
        productName: product.data.name,
        description: product.data.description ?? null,
        unit: product.data.unit ?? "un",
        categoryId,
        brandId,
        variantName: variant.data.name,
        sku: variant.data.sku,
        barcode: variant.data.barcode ?? null,
        priceCents: variant.data.priceCents ?? null,
      });
    }
    return out;
  });

  const valid = result.filter((row) => row.status === "ok");
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();
  for (const row of valid) {
    if (seenSku.has(row.sku!)) {
      row.status = "skipped";
      row.messages = ["SKU repetido no arquivo: vale a primeira linha."];
      continue;
    }
    seenSku.add(row.sku!);
    if (row.barcode && seenBarcode.has(row.barcode)) fail(row, "Código de barras repetido no arquivo.");
    if (row.barcode) seenBarcode.add(row.barcode);
  }
  const skus = valid.filter((row) => row.status === "ok").map((row) => row.sku!);
  const barcodes = valid.filter((row) => row.status === "ok" && row.barcode).map((row) => row.barcode!);
  const takenSku = new Set(
    (await inChunks(skus, (chunk) => tx.select({ value: productVariants.sku }).from(productVariants).where(and(eq(productVariants.organizationId, orgId), inArray(productVariants.sku, chunk))))).map((r) => r.value),
  );
  const takenBarcode = new Set(
    (await inChunks(barcodes, (chunk) => tx.select({ value: productVariants.barcode }).from(productVariants).where(and(eq(productVariants.organizationId, orgId), inArray(productVariants.barcode, chunk))))).map((r) => r.value),
  );
  // Rows of one product must agree on the product fields and stay within the variant limit.
  const groups = new Map<string, { first: PreviewRow; names: Set<string>; size: number }>();
  for (const row of valid) {
    if (row.status !== "ok") continue;
    if (takenSku.has(row.sku!)) fail(row, "SKU já cadastrado.");
    if (row.barcode && takenBarcode.has(row.barcode)) fail(row, "Código de barras já cadastrado.");
    if (row.status !== "ok") continue;
    const group = groups.get(row.groupKey!);
    if (!group) {
      groups.set(row.groupKey!, { first: row, names: new Set([row.variantName!.toLowerCase()]), size: 1 });
      continue;
    }
    const differs = (["unit", "description", "categoryId", "brandId"] as const).filter((key) => (row[key] ?? null) !== (group.first[key] ?? null));
    if (differs.length) fail(row, `Unidade, descrição, categoria e marca têm de ser iguais às da linha ${group.first.line} do mesmo produto.`);
    else if (group.names.has(row.variantName!.toLowerCase())) fail(row, "Nome de variação repetido neste produto.");
    else if (group.size >= MAX_VARIANTS_PER_PRODUCT) fail(row, `Um produto pode ter no máximo ${MAX_VARIANTS_PER_PRODUCT} variações.`);
    else {
      group.names.add(row.variantName!.toLowerCase());
      group.size += 1;
    }
  }
  return result;
}

async function previewCustomers(tx: Tx, orgId: string, header: string[], rows: CsvRow[], mapping: Record<string, string>) {
  const cell = reader(header, mapping);
  const result = rows.map((row) => {
    const out = base(row, header);
    // Marketing consent is never imported: it must come from the customer (contract v2).
    const parsed = customerInputSchema.safeParse({ name: cell(row, "name"), document: cell(row, "document"), email: cell(row, "email"), phone: cell(row, "phone"), marketingConsent: false });
    if (!parsed.success) fail(out, ...messagesOf(parsed.error));
    else Object.assign(out, { customerName: parsed.data.name, document: parsed.data.document, email: parsed.data.email, phone: parsed.data.phone });
    return out;
  });
  const seen = new Set<string>();
  for (const row of result) {
    if (row.status !== "ok" || !row.document) continue;
    if (seen.has(row.document)) {
      row.status = "skipped";
      row.messages = ["CPF repetido no arquivo: vale a primeira linha."];
    }
    seen.add(row.document);
  }
  const documents = result.filter((row) => row.status === "ok" && row.document).map((row) => row.document!);
  const taken = new Set(
    (await inChunks(documents, (chunk) => tx.select({ value: customers.document }).from(customers).where(and(eq(customers.organizationId, orgId), inArray(customers.document, chunk))))).map((r) => r.value),
  );
  for (const row of result) if (row.status === "ok" && row.document && taken.has(row.document)) fail(row, "CPF já cadastrado.");
  return result;
}

async function previewOpeningStock(tx: Tx, orgId: string, storeId: string, header: string[], rows: CsvRow[], mapping: Record<string, string>) {
  const cell = reader(header, mapping);
  const skus = [...new Set(rows.map((row) => cell(row, "sku").toUpperCase()).filter(Boolean))];
  const variants = await inChunks(skus, (chunk) =>
    tx
      .select({ id: productVariants.id, sku: productVariants.sku, unit: products.unit, active: sql<boolean>`${productVariants.isActive} and ${products.isActive}` })
      .from(productVariants)
      .innerJoin(products, and(eq(products.organizationId, productVariants.organizationId), eq(products.id, productVariants.productId)))
      .where(and(eq(productVariants.organizationId, orgId), inArray(productVariants.sku, chunk))),
  );
  const bySku = new Map(variants.map((variant) => [variant.sku, variant]));
  const moved = new Set(
    (await inChunks(variants.map((variant) => variant.id), (chunk) =>
      tx
        .selectDistinct({ id: inventoryMovements.variantId })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.storeId, storeId), inArray(inventoryMovements.variantId, chunk))),
    )).map((r) => r.id),
  );
  const seen = new Set<string>();
  return rows.map((row) => {
    const out = base(row, header);
    const sku = cell(row, "sku").toUpperCase();
    const variant = bySku.get(sku);
    if (!sku) return (fail(out, "SKU: informe o SKU."), out);
    if (!variant) return (fail(out, "SKU não cadastrado."), out);
    const parsed = movementInputSchema.safeParse({ storeId, variantId: variant.id, type: "entry", quantity: cell(row, "quantity"), reason: OPENING_REASON });
    if (!parsed.success) fail(out, ...messagesOf(parsed.error));
    else if (variant.unit === "un" && parsed.data.quantityMilli % BigInt(1000) !== BigInt(0)) fail(out, "Quantidade: produtos vendidos por unidade aceitam apenas quantidades inteiras.");
    if (!variant.active) fail(out, "Produto ou variação inativa não recebe saldo inicial.");
    if (moved.has(variant.id)) fail(out, "O item já tem movimentações nesta loja: lance um inventário em vez do saldo inicial.");
    if (out.status === "ok" && seen.has(sku)) {
      out.status = "skipped";
      out.messages = ["SKU repetido no arquivo: vale a primeira linha."];
    }
    seen.add(sku);
    if (parsed.success) Object.assign(out, { sku, variantId: variant.id, quantity: toDbQuantity(parsed.data.quantityMilli) });
    return out;
  });
}

export async function previewRows(tx: Tx, orgId: string, kind: ImportKind, storeId: string | undefined, header: string[], rows: CsvRow[], mapping: Record<string, string>) {
  for (const column of Object.values(mapping)) {
    if (!header.includes(column)) throw new Error("Mapped column missing from header");
  }
  if (!IMPORT_FIELDS[kind]) throw new Error("Unknown import kind");
  if (kind === "products") return previewProducts(tx, orgId, header, rows, mapping);
  if (kind === "customers") return previewCustomers(tx, orgId, header, rows, mapping);
  return previewOpeningStock(tx, orgId, storeId!, header, rows, mapping);
}
