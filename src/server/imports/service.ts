import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { importMappings, importRows, imports, stores } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, assertStoreInScope } from "@/server/authz/guard";
import { assertCanManageCatalog } from "@/server/catalog/queries";
import { nextDocumentNumber } from "@/server/counters";
import { invalid, isDomainError, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { assertFeature } from "@/server/plans/entitlements";
import { isUuid } from "@/server/stores/schemas";
import { applyUnit, type ImportRow } from "./apply";
import { previewRows } from "./preview";
import { createImportSchema, type ImportKind } from "./schemas";

// CSV imports (m19): createImport stores a validated preview (no business data
// written); confirmImport applies the "ok" rows in batches of about 200 lines per
// transaction, each unit in a savepoint, and is idempotent (applied rows stay
// applied; a second call continues or answers the finished result).

const IMPORT_NOT_FOUND = () => notFound("Importação não encontrada.");
const BATCH_ROWS = 200;
const INSERT_CHUNK = 500;

/** The kind's own permissions on top of imports.manage. */
export function assertKindAllowed(context: TenantContext, kind: ImportKind, storeId: string | null | undefined) {
  assertCan(context, "imports.manage");
  if (kind === "products") assertCanManageCatalog(context);
  if (kind === "customers") assertCan(context, "customers.manage");
  if (kind === "opening_stock") {
    assertCan(context, "inventory.manage");
    assertStoreInScope(context, storeId!);
  }
}

async function audit(tx: Tx, context: TenantContext, entry: { id: string; number: number; storeId: string | null }, action: string, changes: Record<string, unknown>) {
  await recordAudit(tx, {
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: `import.${action}`,
    entityType: "import",
    entityId: entry.id,
    storeId: entry.storeId,
    changes: { number: entry.number, ...changes },
  });
}

async function statusCounts(tx: Tx, organizationId: string, importId: string) {
  const rows = await tx
    .select({ status: importRows.status, value: count() })
    .from(importRows)
    .where(and(eq(importRows.organizationId, organizationId), eq(importRows.importId, importId)))
    .groupBy(importRows.status);
  const counts = { ok: 0, error: 0, skipped: 0, applied: 0, failed: 0 };
  for (const row of rows) counts[row.status] = row.value;
  return counts;
}

export async function createImport(context: TenantContext, rawInput: unknown, file: Uint8Array): Promise<{ id: string; number: number }> {
  assertCan(context, "imports.manage");
  const parsed = createImportSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  const input = parsed.data;
  assertKindAllowed(context, input.kind, input.storeId);
  const decoded = decodeCsv(file);
  if (!decoded.ok) throw invalid(decoded.message, { file: [decoded.message] });
  const csv = parseCsv(decoded.text);
  if (!csv.ok) throw invalid(csv.message, { file: [csv.message] });
  const missing = Object.entries(input.mapping).filter(([, column]) => !csv.header.includes(column));
  if (missing.length) throw invalid("Revise o mapeamento.", Object.fromEntries(missing.map(([field]) => [`mapping.${field}`, ["Coluna não encontrada no arquivo."]])));
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    if (input.kind === "opening_stock") {
      await assertFeature(tx, orgId, "inventory");
      const [store] = await tx.select({ status: stores.status }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.id, input.storeId!)));
      if (!store) throw notFound("Loja não encontrada.");
      if (store.status !== "active") throw invalid("Lojas inativas não recebem saldo inicial.");
    }
    const rows = await previewRows(tx, orgId, input.kind, input.storeId, csv.header, csv.rows, input.mapping);
    const number = await nextDocumentNumber(tx, orgId, "import");
    const [created] = await tx
      .insert(imports)
      .values({ organizationId: orgId, number, kind: input.kind, storeId: input.storeId ?? null, fileName: input.fileName, totalRows: rows.length, createdBy: context.user.id })
      .returning({ id: imports.id });
    await tx.insert(importMappings).values(Object.entries(input.mapping).map(([field, sourceColumn]) => ({ organizationId: orgId, importId: created.id, field, sourceColumn })));
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      await tx.insert(importRows).values(rows.slice(start, start + INSERT_CHUNK).map((row) => ({ ...row, organizationId: orgId, importId: created.id })));
    }
    const counts = { ok: 0, error: 0, skipped: 0 };
    for (const row of rows) counts[row.status as keyof typeof counts] += 1;
    await audit(tx, context, { id: created.id, number, storeId: input.storeId ?? null }, "created", { kind: input.kind, total: rows.length, ...counts });
    return { id: created.id, number };
  });
}

async function lockImport(tx: Tx, context: TenantContext, importId: string) {
  if (!isUuid(importId)) throw IMPORT_NOT_FOUND();
  const [row] = await tx
    .select({ id: imports.id, number: imports.number, kind: imports.kind, status: imports.status, storeId: imports.storeId })
    .from(imports)
    .where(and(eq(imports.organizationId, context.organization.id), eq(imports.id, importId)))
    .for("update");
  if (!row) throw IMPORT_NOT_FOUND();
  assertKindAllowed(context, row.kind, row.storeId);
  return row;
}

/** Next ok rows (about BATCH_ROWS lines); product groups are never split across batches. */
async function nextBatch(tx: Tx, organizationId: string, importId: string, kind: ImportKind) {
  const where = and(eq(importRows.organizationId, organizationId), eq(importRows.importId, importId), eq(importRows.status, "ok"));
  const rows = await tx.select().from(importRows).where(where).orderBy(asc(importRows.line)).limit(BATCH_ROWS);
  if (kind !== "products" || rows.length === 0) return rows.map((row) => [row]);
  const keys = [...new Set(rows.map((row) => row.groupKey!))];
  const all = await tx.select().from(importRows).where(and(where, inArray(importRows.groupKey, keys))).orderBy(asc(importRows.line));
  const groups = new Map<string, ImportRow[]>();
  for (const row of all) groups.set(row.groupKey!, [...(groups.get(row.groupKey!) ?? []), row]);
  return [...groups.values()];
}

function failureMessages(error: { message: string; fieldErrors?: Record<string, string[]> }) {
  const details = Object.values(error.fieldErrors ?? {}).flat();
  return [error.message, ...details].map((message) => message.slice(0, 300)).slice(0, 5);
}

export async function confirmImport(context: TenantContext, importId: string) {
  const orgId = context.organization.id;
  for (;;) {
    const finished = await withScope(dbScope(context), async (tx) => {
      const entry = await lockImport(tx, context, importId);
      if (entry.status === "discarded") throw invalid("Esta prévia foi descartada.");
      if (entry.status === "done") return true;
      if (entry.kind === "opening_stock") await assertFeature(tx, orgId, "inventory");
      if (entry.status === "previewed") {
        await tx.update(imports).set({ status: "applying", confirmedBy: context.user.id, confirmedAt: new Date(), updatedAt: new Date() }).where(and(eq(imports.organizationId, orgId), eq(imports.id, entry.id)));
      }
      const units = await nextBatch(tx, orgId, entry.id, entry.kind);
      if (units.length === 0) {
        const now = new Date();
        await tx.update(imports).set({ status: "done", finishedAt: now, updatedAt: now }).where(and(eq(imports.organizationId, orgId), eq(imports.id, entry.id)));
        const counts = await statusCounts(tx, orgId, entry.id);
        await audit(tx, context, entry, "confirmed", { kind: entry.kind, applied: counts.applied, failed: counts.failed, error: counts.error, skipped: counts.skipped });
        return true;
      }
      for (const unit of units) {
        const ids = unit.map((row) => row.id);
        try {
          const created = await tx.transaction((savepoint) => applyUnit(savepoint, context, entry.kind, entry.storeId, unit));
          const now = new Date();
          for (const [index, row] of unit.entries()) {
            await tx.update(importRows).set({ status: "applied", createdId: created[index], appliedAt: now, updatedAt: now }).where(and(eq(importRows.organizationId, orgId), eq(importRows.id, row.id)));
          }
        } catch (error) {
          if (!isDomainError(error)) throw error;
          await tx
            .update(importRows)
            .set({ status: "failed", messages: failureMessages(error), updatedAt: new Date() })
            .where(and(eq(importRows.organizationId, orgId), inArray(importRows.id, ids)));
        }
      }
      return false;
    });
    if (finished) break;
  }
  return withScope(dbScope(context), (tx) => statusCounts(tx, orgId, importId));
}

/** Drops a preview that was not confirmed, with its rows (they may hold personal data). */
export async function discardImport(context: TenantContext, importId: string): Promise<void> {
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    const entry = await lockImport(tx, context, importId);
    if (entry.status !== "previewed") throw invalid("Só prévias ainda não confirmadas podem ser descartadas.");
    await tx.delete(importRows).where(and(eq(importRows.organizationId, orgId), eq(importRows.importId, entry.id)));
    await tx.update(imports).set({ status: "discarded", updatedAt: new Date() }).where(and(eq(imports.organizationId, orgId), eq(imports.id, entry.id)));
    await audit(tx, context, entry, "discarded", { kind: entry.kind });
  });
}
