import "server-only";
import { and, asc, count, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { importMappings, importRows, imports, stores, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { maskCpf } from "@/server/customers/schemas";
import { pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import type { ImportFilters, ImportRowFilters } from "./schemas";

// Read side of the CSV imports. Opening-stock imports of stores out of scope are
// hidden; CPFs are masked for members without customers.documents.read.

function visible(context: TenantContext): SQL | undefined {
  if (context.storeScope.all) return undefined;
  // Store-less kinds (products, customers) are organization data; opening stock follows the store scope.
  return or(isNull(imports.storeId), storeScopeCondition(context.storeScope, imports.storeId));
}

export async function listImports(context: TenantContext, filters: ImportFilters) {
  assertCan(context, "imports.manage");
  const orgId = context.organization.id;
  const scope = visible(context);
  const conditions: (SQL | undefined)[] = [eq(imports.organizationId, orgId)];
  if (scope) conditions.push(scope);
  if (filters.kind) conditions.push(eq(imports.kind, filters.kind));
  if (filters.status) conditions.push(eq(imports.status, filters.status));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(imports).where(where);
    const rows = await tx
      .select({ id: imports.id, number: imports.number, kind: imports.kind, status: imports.status, fileName: imports.fileName, totalRows: imports.totalRows, createdAt: imports.createdAt, createdByName: users.name })
      .from(imports)
      .leftJoin(users, eq(users.id, imports.createdBy))
      .where(where)
      .orderBy(desc(imports.number))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

export async function getImport(context: TenantContext, importId: string, filters: ImportRowFilters) {
  assertCan(context, "imports.manage");
  if (!isUuid(importId)) return null;
  const orgId = context.organization.id;
  const scope = visible(context);
  const fullDocument = can(context, "customers.documents.read");
  return withScope(dbScope(context), async (tx) => {
    const [header] = await tx
      .select({
        id: imports.id,
        number: imports.number,
        kind: imports.kind,
        status: imports.status,
        fileName: imports.fileName,
        totalRows: imports.totalRows,
        storeId: imports.storeId,
        storeName: stores.name,
        createdAt: imports.createdAt,
        createdByName: users.name,
        confirmedAt: imports.confirmedAt,
        finishedAt: imports.finishedAt,
      })
      .from(imports)
      .leftJoin(stores, and(eq(stores.organizationId, imports.organizationId), eq(stores.id, imports.storeId)))
      .leftJoin(users, eq(users.id, imports.createdBy))
      .where(and(eq(imports.organizationId, orgId), eq(imports.id, importId), scope));
    if (!header) return null;
    const mapping = await tx
      .select({ field: importMappings.field, sourceColumn: importMappings.sourceColumn })
      .from(importMappings)
      .where(and(eq(importMappings.organizationId, orgId), eq(importMappings.importId, importId)));
    const byStatus = await tx
      .select({ status: importRows.status, value: count() })
      .from(importRows)
      .where(and(eq(importRows.organizationId, orgId), eq(importRows.importId, importId)))
      .groupBy(importRows.status);
    const counts = { ok: 0, error: 0, skipped: 0, applied: 0, failed: 0 };
    for (const row of byStatus) counts[row.status] = row.value;
    const where = and(eq(importRows.organizationId, orgId), eq(importRows.importId, importId), filters.status ? eq(importRows.status, filters.status) : undefined);
    const [total] = await tx.select({ value: count() }).from(importRows).where(where);
    const { limit, offset } = pageWindow(filters.page);
    const rows = await tx
      .select({
        line: importRows.line,
        status: importRows.status,
        messages: importRows.messages,
        productName: importRows.productName,
        variantName: importRows.variantName,
        sku: importRows.sku,
        priceCents: importRows.priceCents,
        customerName: importRows.customerName,
        document: importRows.document,
        email: importRows.email,
        phone: importRows.phone,
        quantity: importRows.quantity,
      })
      .from(importRows)
      .where(where)
      .orderBy(asc(importRows.line))
      .limit(limit)
      .offset(offset);
    const presented = rows.map((row) => ({ ...row, document: row.document && !fullDocument ? maskCpf(row.document) : row.document }));
    return { ...header, mapping, counts, rows: pageResult(presented, total.value, filters.page) };
  });
}

