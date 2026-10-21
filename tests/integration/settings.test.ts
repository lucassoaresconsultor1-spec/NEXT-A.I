import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, organizationSettings, storeSettings } from "@/db/schema";
import { withScope } from "@/db/tenant";
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  getOperationalSettings,
  loadEffectiveSettings,
  updateOrganizationOperations,
  updateStoreOperations,
} from "@/server/settings/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture } from "./fixtures";

const orgForm = { customerRequirement: "required", maxDiscountBps: "10", receiptHeader: "Loja Teste\nCNPJ na nota", receiptFooter: "Volte sempre" };
const inherit = { customerRequirement: "", maxDiscountBps: "", receiptHeader: "" };

async function effective(organizationId: string, storeId: string) {
  return withScope({ organizationId }, (tx) => loadEffectiveSettings(tx, organizationId, storeId));
}

async function settingsTrail(organizationId: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ action: auditLogs.action, entityId: auditLogs.entityId, storeId: auditLogs.storeId, changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityType, "operational_settings")))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

describe("operational settings: defaults and inheritance", () => {
  it("returns the defaults when nothing was saved", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    expect(await effective(organizationId, storeId)).toEqual({
      ...DEFAULT_OPERATIONAL_SETTINGS,
      source: { customerRequirement: "default", maxDiscountBps: "default", receiptHeader: "default" },
    });
    const screen = await getOperationalSettings(owner);
    expect(screen.organization).toEqual(DEFAULT_OPERATIONAL_SETTINGS);
    expect(screen.stores).toEqual([
      expect.objectContaining({ storeId, override: { customerRequirement: null, maxDiscountBps: null, receiptHeader: null }, effective: DEFAULT_OPERATIONAL_SETTINGS }),
    ]);
  });

  it("applies organization values, store overrides per field and clears overrides", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);

    await updateOrganizationOperations(owner, orgForm);
    expect(await effective(organizationId, storeId)).toMatchObject({
      customerRequirement: "required",
      maxDiscountBps: 1000,
      receiptHeader: "Loja Teste\nCNPJ na nota",
      receiptFooter: "Volte sempre",
      source: { customerRequirement: "organization", maxDiscountBps: "organization", receiptHeader: "organization" },
    });

    await updateStoreOperations(owner, storeId, { ...inherit, maxDiscountBps: "2,5" });
    expect(await effective(organizationId, storeId)).toMatchObject({
      customerRequirement: "required",
      maxDiscountBps: 250,
      source: { customerRequirement: "organization", maxDiscountBps: "store", receiptHeader: "organization" },
    });

    await updateStoreOperations(owner, storeId, inherit);
    const rows = await withScope({ organizationId }, (tx) =>
      tx.select().from(storeSettings).where(and(eq(storeSettings.organizationId, organizationId), eq(storeSettings.storeId, storeId))),
    );
    expect(rows).toHaveLength(0);
    expect((await effective(organizationId, storeId)).maxDiscountBps).toBe(1000);

    const trail = await settingsTrail(organizationId);
    expect(trail.map((entry) => entry.action)).toEqual([
      "settings.operations_updated",
      "settings.store_operations_updated",
      "settings.store_operations_cleared",
    ]);
    expect(trail[0]).toMatchObject({ entityId: null, storeId: null });
    expect(trail[0].changes).toEqual({
      customerRequirement: { from: "optional", to: "required" },
      maxDiscountBps: { from: 0, to: 1000 },
      receiptHeader: { from: null, to: "Loja Teste\nCNPJ na nota" },
      receiptFooter: { from: null, to: "Volte sempre" },
    });
    expect(trail[1]).toMatchObject({ entityId: storeId, storeId, changes: { maxDiscountBps: { from: null, to: 250 } } });
    expect(trail[2].changes).toEqual({ maxDiscountBps: { from: 250, to: null } });
  });

  it("does not write or audit when nothing changes", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    await updateOrganizationOperations(owner, orgForm);
    await updateOrganizationOperations(owner, orgForm);
    await updateStoreOperations(owner, storeId, inherit);
    expect(await settingsTrail(organizationId)).toHaveLength(1);
  });

  it("validates inside the service, not only in the form", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    await expect(updateOrganizationOperations(owner, { ...orgForm, maxDiscountBps: 10001 })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { maxDiscountBps: expect.any(Array) },
    });
    await expect(updateStoreOperations(owner, storeId, { ...inherit, receiptHeader: "1\n2\n3\n4\n5" })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { receiptHeader: expect.any(Array) },
    });
  });
});

describe("operational settings: access", () => {
  it("refuses members without settings.operations.manage", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] });
    await expect(updateOrganizationOperations(manager.context, orgForm)).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateStoreOperations(manager.context, storeId, { ...inherit, maxDiscountBps: "5" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getOperationalSettings(manager.context)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("limits a store-scoped administrator to the stores in scope", async () => {
    const { organizationId } = await createOrganizationFixture();
    const inScope = await createStoreFixture(organizationId);
    const outOfScope = await createStoreFixture(organizationId);
    const admin = await addMemberFixture(organizationId, { roleKey: "admin", storeIds: [inScope] });

    await expect(updateOrganizationOperations(admin.context, orgForm)).rejects.toMatchObject({ code: "forbidden" });
    await updateStoreOperations(admin.context, inScope, { ...inherit, customerRequirement: "none" });
    await expect(updateStoreOperations(admin.context, outOfScope, { ...inherit, customerRequirement: "none" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(updateStoreOperations(admin.context, "not-a-uuid", inherit)).rejects.toMatchObject({ code: "not_found" });

    const screen = await getOperationalSettings(admin.context);
    expect(screen.stores.map((store) => store.storeId)).toEqual([inScope]);
    expect(screen.stores[0].effective.customerRequirement).toBe("none");
  });

  it("isolates organizations", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const storeA = await createStoreFixture(a.organizationId);
    await updateOrganizationOperations(a.owner, orgForm);
    await updateStoreOperations(a.owner, storeA, { ...inherit, maxDiscountBps: "3" });

    await expect(updateStoreOperations(b.owner, storeA, { ...inherit, maxDiscountBps: "50" })).rejects.toMatchObject({ code: "not_found" });
    expect((await getOperationalSettings(b.owner)).organization).toEqual(DEFAULT_OPERATIONAL_SETTINGS);

    const seenByB = await withScope({ organizationId: b.organizationId }, async (tx) => ({
      organizations: await tx.select().from(organizationSettings),
      stores: await tx.select().from(storeSettings),
    }));
    expect(seenByB.organizations.some((row) => row.organizationId === a.organizationId)).toBe(false);
    expect(seenByB.stores.some((row) => row.organizationId === a.organizationId)).toBe(false);
  });
});
