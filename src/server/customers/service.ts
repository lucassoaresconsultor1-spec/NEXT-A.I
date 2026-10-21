import "server-only";
import { and, asc, count, eq, ilike, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { customers } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { isValidCpf, onlyDigits } from "@/lib/documents";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/guard";
import { conflict, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { likePattern, pageResult, pageWindow } from "@/server/pagination";
import { isUuid } from "@/server/stores/schemas";
import { customerInputSchema, maskCpf, maskEmail, maskPhone, type CustomerFilters, type CustomerInput } from "./schemas";

// Customers belong to the organization (every store serves the same buyer).
// The full CPF only leaves this module for members with customers.documents.read;
// audit entries always carry masked contacts, and nothing personal is logged.

export type { CustomerFilters } from "./schemas";

const CUSTOMER_NOT_FOUND = () => notFound("Cliente não encontrado.");
const DOCUMENT_CONSTRAINT = "customers_org_document_idx";
const AUDIT_FIELDS = ["name", "document", "email", "phone", "marketingConsent"] as const;

export interface CustomerRow {
  id: string;
  name: string;
  document: string | null;
  documentMasked: boolean;
  email: string | null;
  phone: string | null;
  marketingConsent: boolean;
  consentAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const columns = {
  id: customers.id,
  name: customers.name,
  document: customers.document,
  email: customers.email,
  phone: customers.phone,
  marketingConsent: customers.marketingConsent,
  consentAt: customers.consentAt,
  isActive: customers.isActive,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};
type StoredCustomer = Omit<CustomerRow, "documentMasked">;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

const canSeeDocuments = (context: TenantContext) => can(context, "customers.documents.read");

function present(row: StoredCustomer, fullDocument: boolean): CustomerRow {
  const masked = !fullDocument && row.document !== null;
  return { ...row, document: masked && row.document ? maskCpf(row.document) : row.document, documentMasked: masked };
}

/** Masked copy of the personal fields for audit entries. */
function auditView(values: Pick<CustomerInput, "name" | "document" | "email" | "phone" | "marketingConsent">) {
  return {
    name: values.name,
    document: values.document ? maskCpf(values.document) : null,
    email: values.email ? maskEmail(values.email) : null,
    phone: values.phone ? maskPhone(values.phone) : null,
    marketingConsent: values.marketingConsent,
  };
}

function translateErrors(error: unknown): never {
  if (isUniqueViolation(error, DOCUMENT_CONSTRAINT)) {
    throw conflict("Já existe um cliente com este CPF.", { document: ["CPF já cadastrado nesta empresa."] });
  }
  throw error;
}

/** e-mail, then valid CPF, then phone, then name (section 4.3 of the m28a contract). */
function searchCondition(q: string): SQL | undefined {
  const digits = onlyDigits(q);
  if (q.includes("@")) return eq(customers.email, q.toLowerCase());
  if (digits.length === 11 && isValidCpf(digits)) return eq(customers.document, digits);
  if (/^[\d\s()-]+$/.test(q) && (digits.length === 10 || digits.length === 11)) return eq(customers.phone, digits);
  if (q.length < 2) return undefined;
  return ilike(customers.name, likePattern(q));
}

export async function listCustomers(context: TenantContext, filters: CustomerFilters) {
  assertCan(context, "customers.read");
  const conditions: (SQL | undefined)[] = [eq(customers.organizationId, context.organization.id)];
  if (filters.q) conditions.push(searchCondition(filters.q));
  if (filters.status) conditions.push(eq(customers.isActive, filters.status === "active"));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  const fullDocument = canSeeDocuments(context);
  return withScope(dbScope(context), async (tx) => {
    const [total] = await tx.select({ value: count() }).from(customers).where(where);
    const rows = await tx
      .select(columns)
      .from(customers)
      .where(where)
      .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
      .limit(limit)
      .offset(offset);
    return pageResult(
      rows.map((row) => present(row, fullDocument)),
      total.value,
      filters.page,
    );
  });
}

export async function getCustomer(context: TenantContext, id: string): Promise<CustomerRow | null> {
  assertCan(context, "customers.read");
  if (!isUuid(id)) return null;
  const [row] = await withScope(dbScope(context), (tx) =>
    tx
      .select(columns)
      .from(customers)
      .where(and(eq(customers.organizationId, context.organization.id), eq(customers.id, id))),
  );
  return row ? present(row, canSeeDocuments(context)) : null;
}

export async function createCustomer(context: TenantContext, input: unknown) {
  assertCan(context, "customers.manage");
  return withScope(dbScope(context), (tx) => createCustomerInTx(tx, context, input));
}

/** Same as createCustomer inside the caller's transaction (CSV import applies many rows per transaction). */
export async function createCustomerInTx(tx: Tx, context: TenantContext, input: unknown) {
  assertCan(context, "customers.manage");
  const values = parse(customerInputSchema, input);
  const orgId = context.organization.id;
  try {
    const [created] = await tx
      .insert(customers)
      .values({
        organizationId: orgId,
        ...values,
        consentAt: values.marketingConsent ? sql`now()` : null,
        createdBy: context.user.id,
      })
      .returning({ id: customers.id });
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "customer.created",
      entityType: "customer",
      entityId: created.id,
      changes: auditView(values),
    });
    return { id: created.id };
  } catch (error) {
    translateErrors(error);
  }
}

/**
 * Members without customers.documents.read only know the masked CPF: sending it
 * back keeps the stored value; typing a full CPF replaces it; clearing is refused.
 */
export async function updateCustomer(context: TenantContext, id: string, input: unknown) {
  assertCan(context, "customers.manage");
  const fullDocument = canSeeDocuments(context);
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const sentDocument = typeof raw.document === "string" ? raw.document.trim() : raw.document;
  if (!isUuid(id)) throw CUSTOMER_NOT_FOUND();
  const orgId = context.organization.id;
  const target = and(eq(customers.organizationId, orgId), eq(customers.id, id));
  try {
    await withScope(dbScope(context), async (tx) => {
      const [current] = await tx.select(columns).from(customers).where(target).for("update");
      if (!current) throw CUSTOMER_NOT_FOUND();
      let keepDocument = false;
      if (!fullDocument && current.document) {
        if (sentDocument === maskCpf(current.document)) keepDocument = true;
        else if (sentDocument === undefined || sentDocument === null || sentDocument === "") {
          throw invalid("Revise os campos destacados.", { document: ["Seu perfil não pode remover o CPF do cliente."] });
        }
      }
      const next = parse(customerInputSchema, keepDocument ? { ...raw, document: "" } : raw);
      if (keepDocument) next.document = current.document;
      // Decide on the real values: different e-mails, phones or CPFs can share a mask.
      const changedFields = Object.keys(diffFields(current, next, AUDIT_FIELDS)) as (typeof AUDIT_FIELDS)[number][];
      if (changedFields.length === 0) return;
      const before = auditView(current);
      const after = auditView(next);
      // Audit every really changed field, even when its masked value looks the same.
      const changes = Object.fromEntries(changedFields.map((field) => [field, { from: before[field], to: after[field] }]));
      const consentAt = next.marketingConsent === current.marketingConsent ? current.consentAt : next.marketingConsent ? new Date() : null;
      await tx
        .update(customers)
        .set({ ...next, consentAt, updatedAt: new Date() })
        .where(target);
      await recordAudit(tx, {
        organizationId: orgId,
        actorUserId: context.user.id,
        action: "customer.updated",
        entityType: "customer",
        entityId: id,
        changes,
      });
    });
  } catch (error) {
    translateErrors(error);
  }
}

export async function setCustomerActive(context: TenantContext, id: string, isActive: boolean) {
  assertCan(context, "customers.manage");
  if (!isUuid(id)) throw CUSTOMER_NOT_FOUND();
  const orgId = context.organization.id;
  const target = and(eq(customers.organizationId, orgId), eq(customers.id, id));
  await withScope(dbScope(context), async (tx) => {
    const [current] = await tx.select({ isActive: customers.isActive }).from(customers).where(target).for("update");
    if (!current) throw CUSTOMER_NOT_FOUND();
    if (current.isActive === isActive) return;
    await tx.update(customers).set({ isActive, updatedAt: new Date() }).where(target);
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "customer.status_changed",
      entityType: "customer",
      entityId: id,
      changes: { isActive: { from: current.isActive, to: isActive } },
    });
  });
}

/** For other services in their own transaction (m06a): the active customer of the organization or null. No permission check. */
export async function loadActiveCustomer(tx: Tx, organizationId: string, id: string): Promise<{ id: string; name: string } | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, id), eq(customers.isActive, true)));
  return row ?? null;
}
