import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { organizationSettings, stores, storeSettings } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { diffFields, recordAudit } from "@/server/audit/record";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";
import { assertCan, assertOrganizationWide, assertStoreInScope } from "@/server/authz/guard";
import { invalid, notFound } from "@/server/errors";
import { fieldErrorsOf } from "@/server/forms";
import { isUuid } from "@/server/stores/schemas";
import { organizationOperationsSchema, storeOperationsSchema, type CustomerRequirement } from "./schemas";

// Operational rules (customer on the sale, discount ceiling, receipt texts) per
// organization, with optional per-store overrides. Missing rows mean defaults,
// so nothing is seeded. Other services read the effective values inside their
// own transaction through loadEffectiveSettings.

export interface OperationalSettings {
  customerRequirement: CustomerRequirement;
  maxDiscountBps: number;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

export interface StoreOverride {
  customerRequirement: CustomerRequirement | null;
  maxDiscountBps: number | null;
  receiptHeader: string | null;
}

type OverridableField = keyof StoreOverride;
export type SettingSource = "organization" | "store" | "default";

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  customerRequirement: "optional",
  maxDiscountBps: 0,
  receiptHeader: null,
  receiptFooter: null,
};

const ORGANIZATION_FIELDS = ["customerRequirement", "maxDiscountBps", "receiptHeader", "receiptFooter"] as const;
const STORE_FIELDS = ["customerRequirement", "maxDiscountBps", "receiptHeader"] as const;
const EMPTY_OVERRIDE: StoreOverride = { customerRequirement: null, maxDiscountBps: null, receiptHeader: null };
const STORE_NOT_FOUND = () => notFound("Loja não encontrada.");

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid("Revise os campos destacados.", fieldErrorsOf(parsed.error));
  return parsed.data;
}

const organizationColumns = {
  customerRequirement: organizationSettings.customerRequirement,
  maxDiscountBps: organizationSettings.maxDiscountBps,
  receiptHeader: organizationSettings.receiptHeader,
  receiptFooter: organizationSettings.receiptFooter,
};

const overrideColumns = {
  customerRequirement: storeSettings.customerRequirement,
  maxDiscountBps: storeSettings.maxDiscountBps,
  receiptHeader: storeSettings.receiptHeader,
};

async function readOrganization(tx: Tx, organizationId: string): Promise<OperationalSettings | null> {
  const [row] = await tx.select(organizationColumns).from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId));
  return row ?? null;
}

function merge(organization: OperationalSettings | null, override: StoreOverride | null) {
  const base = organization ?? DEFAULT_OPERATIONAL_SETTINGS;
  const effective: OperationalSettings = { ...base };
  const source = {} as Record<OverridableField, SettingSource>;
  for (const field of STORE_FIELDS) {
    const value = override?.[field] ?? null;
    if (value !== null) {
      (effective as unknown as Record<string, unknown>)[field] = value;
      source[field] = "store";
    } else {
      source[field] = organization ? "organization" : "default";
    }
  }
  return { effective, source };
}

/** Effective settings of a store, for other services inside their own transaction (no permission check: the caller already authorized its operation). */
export async function loadEffectiveSettings(tx: Tx, organizationId: string, storeId: string) {
  const organization = await readOrganization(tx, organizationId);
  const [override] = await tx
    .select(overrideColumns)
    .from(storeSettings)
    .where(and(eq(storeSettings.organizationId, organizationId), eq(storeSettings.storeId, storeId)));
  const { effective, source } = merge(organization, override ?? null);
  return { ...effective, source };
}

/** Screen data: organization defaults and every store in the member's scope with its override and effective values. */
export async function getOperationalSettings(context: TenantContext) {
  assertCan(context, "organization.settings.read");
  const orgId = context.organization.id;
  return withScope(dbScope(context), async (tx) => {
    const organization = await readOrganization(tx, orgId);
    const rows = await tx
      .select({ storeId: stores.id, code: stores.code, name: stores.name, ...overrideColumns })
      .from(stores)
      .leftJoin(storeSettings, and(eq(storeSettings.organizationId, stores.organizationId), eq(storeSettings.storeId, stores.id)))
      .where(and(eq(stores.organizationId, orgId), storeScopeCondition(context.storeScope, stores.id)))
      .orderBy(asc(stores.name))
      .limit(1000);
    return {
      organization: organization ?? DEFAULT_OPERATIONAL_SETTINGS,
      stores: rows.map(({ storeId, code, name, ...override }) => ({
        storeId,
        code,
        name,
        override,
        effective: merge(organization, override).effective,
      })),
    };
  });
}

/** Organization defaults. Needs settings.operations.manage and organization-wide scope; audits only changed fields. */
export async function updateOrganizationOperations(context: TenantContext, input: unknown) {
  assertCan(context, "settings.operations.manage");
  assertOrganizationWide(context);
  const next = parse(organizationOperationsSchema, input);
  const orgId = context.organization.id;
  await withScope(dbScope(context), async (tx) => {
    // Creating the row first lets the lock below serialize concurrent first-time saves.
    await tx.insert(organizationSettings).values({ organizationId: orgId }).onConflictDoNothing();
    const [current] = await tx
      .select(organizationColumns)
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .for("update");
    const changes = diffFields(current, next, ORGANIZATION_FIELDS);
    if (Object.keys(changes).length === 0) return;
    await tx
      .update(organizationSettings)
      .set({ ...next, updatedBy: context.user.id, updatedAt: new Date() })
      .where(eq(organizationSettings.organizationId, orgId));
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: "settings.operations_updated",
      entityType: "operational_settings",
      changes,
    });
  });
}

/** Store override. Needs settings.operations.manage and the store in scope; all fields null removes the override. */
export async function updateStoreOperations(context: TenantContext, storeId: string, input: unknown) {
  assertCan(context, "settings.operations.manage");
  const next = parse(storeOperationsSchema, input);
  if (!isUuid(storeId)) throw STORE_NOT_FOUND();
  assertStoreInScope(context, storeId);
  const orgId = context.organization.id;
  const target = and(eq(storeSettings.organizationId, orgId), eq(storeSettings.storeId, storeId));
  const clearing = STORE_FIELDS.every((field) => next[field] === null);
  await withScope(dbScope(context), async (tx) => {
    const [store] = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.organizationId, orgId), eq(stores.id, storeId)));
    if (!store) throw STORE_NOT_FOUND();
    const [existing] = await tx.select(overrideColumns).from(storeSettings).where(target).for("update");
    const current = existing ?? EMPTY_OVERRIDE;
    const changes = diffFields(current, next, STORE_FIELDS);
    if (Object.keys(changes).length === 0) return;
    if (clearing) {
      await tx.delete(storeSettings).where(target);
    } else {
      await tx
        .insert(storeSettings)
        .values({ organizationId: orgId, storeId, ...next, updatedBy: context.user.id })
        .onConflictDoUpdate({
          target: [storeSettings.organizationId, storeSettings.storeId],
          set: { ...next, updatedBy: context.user.id, updatedAt: new Date() },
        });
    }
    await recordAudit(tx, {
      organizationId: orgId,
      actorUserId: context.user.id,
      action: clearing ? "settings.store_operations_cleared" : "settings.store_operations_updated",
      entityType: "operational_settings",
      entityId: storeId,
      storeId,
      changes,
    });
  });
}
