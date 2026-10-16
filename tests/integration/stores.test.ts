import { and, asc, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, organizations, rolePermissions, roles, stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { storeFiltersSchema, type StoreInput } from "@/server/stores/schemas";
import { createStore, getStore, getStorePlanUsage, listStores, setStoreStatus, updateStore } from "@/server/stores/service";
import { addMemberFixture, createOrganizationFixture, createRegionFixture, createStoreFixture, uniqueSuffix } from "./fixtures";

const filters = (values: Record<string, unknown> = {}) => storeFiltersSchema.parse(values);
const newCode = () => `T${uniqueSuffix().toUpperCase().slice(0, 6)}`;
const storeInput = (values: Partial<StoreInput> = {}): StoreInput => ({ code: newCode(), name: "Loja de Teste", ...values });

async function setPlan(organizationId: string, planKey: string) {
  await withScope({ organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, organizationId)));
}

async function auditTrail(organizationId: string, entityId: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ action: auditLogs.action, changes: auditLogs.changes, storeId: auditLogs.storeId, actorUserId: auditLogs.actorUserId })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, entityId)))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

async function storeRow(organizationId: string, storeId: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx.select({ name: stores.name, status: stores.status, regionId: stores.regionId }).from(stores).where(eq(stores.id, storeId)),
  );
  return row;
}

/** Custom role with stores.manage limited to explicit stores (no system role combines both). */
async function addScopedStoreEditor(organizationId: string, storeIds: string[]) {
  const key = `editor_${uniqueSuffix()}`;
  await withScope({ organizationId }, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ organizationId, key, name: `Editor de lojas ${key}`, isSystem: false, rank: 45 })
      .returning({ id: roles.id });
    await tx.insert(rolePermissions).values([
      { organizationId, roleId: role.id, permission: "stores.read" },
      { organizationId, roleId: role.id, permission: "stores.manage" },
    ]);
  });
  return addMemberFixture(organizationId, { roleKey: key, storeAccess: "stores", storeIds });
}

describe("stores service: lifecycle", () => {
  it("creates, lists, reads, updates and changes the status of a store, with audit entries", async () => {
    const { organizationId, owner, ownerId } = await createOrganizationFixture();
    const regionId = await createRegionFixture(organizationId, "Capital");
    const created = await createStore(owner, {
      code: " sp-centro ",
      name: "Loja Centro",
      document: "11.222.333/0001-81",
      phone: "(11) 3333-4444",
      postalCode: "01310-100",
      city: "São Paulo",
      state: "SP",
      regionId,
    });

    const store = await getStore(owner, created.id);
    expect(store).toMatchObject({
      code: "SP-CENTRO",
      name: "Loja Centro",
      document: "11222333000181",
      phone: "1133334444",
      postalCode: "01310100",
      status: "active",
      regionId,
      regionName: "Capital",
      timezone: null,
    });

    expect((await listStores(owner, filters({ q: "centro" }))).rows.map((row) => row.id)).toEqual([created.id]);
    expect((await listStores(owner, filters({ q: "sp-cen" }))).rows.map((row) => row.regionName)).toEqual(["Capital"]);
    expect((await listStores(owner, filters({ q: "%" }))).total).toBe(0);
    expect((await listStores(owner, filters({ regionId }))).total).toBe(1);
    expect((await listStores(owner, filters({ regionId: "none" }))).total).toBe(0);
    expect((await listStores(owner, filters({ status: "inactive" }))).total).toBe(0);

    await updateStore(owner, created.id, { code: "SP-CENTRO", name: "Loja Centro Renovada", regionId: null, timezone: "America/Manaus" });
    expect(await getStore(owner, created.id)).toMatchObject({
      name: "Loja Centro Renovada",
      regionId: null,
      regionName: null,
      timezone: "America/Manaus",
      document: null,
    });

    expect(await setStoreStatus(owner, created.id, "inactive")).toEqual({ changed: true });
    expect(await setStoreStatus(owner, created.id, "inactive")).toEqual({ changed: false });
    expect((await listStores(owner, filters({ status: "inactive" }))).rows.map((row) => row.id)).toEqual([created.id]);

    const trail = await auditTrail(organizationId, created.id);
    expect(trail.map((entry) => entry.action)).toEqual(["store.created", "store.updated", "store.status_changed"]);
    expect(trail.every((entry) => entry.storeId === created.id && entry.actorUserId === ownerId)).toBe(true);
    expect(trail[0].changes).toMatchObject({ code: "SP-CENTRO", name: "Loja Centro", regionId });
    expect(trail[1].changes).toMatchObject({
      name: { from: "Loja Centro", to: "Loja Centro Renovada" },
      regionId: { from: regionId, to: null },
      timezone: { from: null, to: "America/Manaus" },
    });
    expect(trail[1].changes).not.toHaveProperty("code");
    expect(trail[2].changes).toEqual({ status: { from: "active", to: "inactive" } });
  });

  it("does not write an audit entry when an update changes nothing", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const created = await createStore(owner, storeInput({ code: "IGUAL-1", name: "Loja Igual" }));
    await updateStore(owner, created.id, { code: "igual-1", name: "Loja Igual" });
    expect((await auditTrail(organizationId, created.id)).map((entry) => entry.action)).toEqual(["store.created"]);
  });

  it("sorts by whitelisted columns and paginates on the server", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    for (let index = 0; index < 26; index += 1) {
      await createStoreFixture(organizationId, { code: `P${String(index).padStart(2, "0")}`, name: `Loja ${String(index).padStart(2, "0")}` });
    }
    const first = await listStores(owner, filters({ sort: "code", dir: "desc" }));
    expect(first.total).toBe(26);
    expect(first.pageCount).toBe(2);
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0].code).toBe("P25");
    const second = await listStores(owner, filters({ sort: "code", dir: "desc", page: "2" }));
    expect(second.rows.map((row) => row.code)).toEqual(["P00"]);
  });
});

describe("stores service: codes and plan limits", () => {
  it("keeps codes unique per organization but allows the same code in another organization", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    await setPlan(a.organizationId, "rede");
    await createStore(a.owner, storeInput({ code: "MATRIZ" }));
    await expect(createStore(a.owner, storeInput({ code: "matriz" }))).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { code: ["Código já utilizado nesta empresa."] },
    });
    const other = await createStore(a.owner, storeInput({ code: "FILIAL" }));
    await expect(updateStore(a.owner, other.id, { code: "MATRIZ", name: "Filial" })).rejects.toMatchObject({ code: "conflict" });
    await expect(createStore(b.owner, storeInput({ code: "MATRIZ" }))).resolves.toHaveProperty("id");
  });

  it("applies the Essencial limit of one active store and frees the slot on deactivation", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    expect(await getStorePlanUsage(owner)).toMatchObject({ maxStores: 1, activeStores: 0 });
    const first = await createStore(owner, storeInput({ code: "LIM-1" }));
    await expect(createStore(owner, storeInput({ code: "LIM-2" }))).rejects.toMatchObject({ code: "limit" });
    const [rejected] = await withScope({ organizationId }, (tx) =>
      tx.select({ value: count() }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.code, "LIM-2"))),
    );
    expect(rejected.value).toBe(0);

    await setStoreStatus(owner, first.id, "inactive");
    const second = await createStore(owner, storeInput({ code: "LIM-2" }));
    await expect(setStoreStatus(owner, first.id, "active")).rejects.toMatchObject({ code: "limit" });
    expect((await storeRow(organizationId, first.id)).status).toBe("inactive");

    await setStoreStatus(owner, second.id, "inactive");
    await setStoreStatus(owner, first.id, "active");
    expect(await getStorePlanUsage(owner)).toMatchObject({ maxStores: 1, activeStores: 1 });

    await setPlan(organizationId, "rede");
    await setStoreStatus(owner, second.id, "active");
    await createStore(owner, storeInput({ code: "LIM-3" }));
    expect(await getStorePlanUsage(owner)).toMatchObject({ maxStores: null, activeStores: 3 });
  });

  it("validates input inside the service as well", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    await expect(createStore(owner, { code: "loja centro", name: "L", postalCode: "123" })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { code: expect.any(Array), name: expect.any(Array), postalCode: expect.any(Array) },
    });
    const [total] = await withScope({ organizationId }, (tx) =>
      tx.select({ value: count() }).from(stores).where(eq(stores.organizationId, organizationId)),
    );
    expect(total.value).toBe(0);
  });
});

describe("stores service: authorization and isolation", () => {
  it("limits a store manager to the linked store", async () => {
    const { organizationId } = await createOrganizationFixture();
    const regionId = await createRegionFixture(organizationId);
    const storeA = await createStoreFixture(organizationId, { regionId });
    const storeB = await createStoreFixture(organizationId);
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] });

    const listed = await listStores(manager.context, filters());
    expect(listed.rows.map((row) => row.id)).toEqual([storeA]);
    expect(listed.total).toBe(1);
    expect(await getStore(manager.context, storeA)).not.toBeNull();
    expect(await getStore(manager.context, storeB)).toBeNull();
    // The system store manager role cannot edit store records at all.
    await expect(updateStore(manager.context, storeB, storeInput())).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateStore(manager.context, storeA, storeInput({ regionId: null }))).rejects.toMatchObject({ code: "forbidden" });
    expect((await storeRow(organizationId, storeA)).regionId).toBe(regionId);
  });

  it("lets a scoped editor change only stores in scope and never their region", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const regionId = await createRegionFixture(organizationId);
    const otherRegion = await createRegionFixture(organizationId);
    const storeA = await createStoreFixture(organizationId, { regionId, name: "Loja A" });
    const storeB = await createStoreFixture(organizationId, { name: "Loja B" });
    const editor = await addScopedStoreEditor(organizationId, [storeA]);

    await expect(updateStore(editor.context, storeB, storeInput({ name: "Invadida" }))).rejects.toMatchObject({ code: "not_found" });
    await expect(setStoreStatus(editor.context, storeB, "inactive")).rejects.toMatchObject({ code: "not_found" });
    expect(await storeRow(organizationId, storeB)).toMatchObject({ name: "Loja B", status: "active" });

    await expect(updateStore(editor.context, storeA, storeInput({ regionId: otherRegion }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateStore(editor.context, storeA, storeInput({ regionId: null }))).rejects.toMatchObject({ code: "forbidden" });
    await updateStore(editor.context, storeA, storeInput({ name: "Loja A Revisada" }));
    expect(await storeRow(organizationId, storeA)).toMatchObject({ name: "Loja A Revisada", regionId });

    await expect(createStore(editor.context, storeInput())).rejects.toMatchObject({ code: "forbidden" });
    await expect(getStorePlanUsage(editor.context)).rejects.toMatchObject({ code: "forbidden" });
    await setStoreStatus(editor.context, storeA, "inactive");
    expect((await getStore(owner, storeA))?.status).toBe("inactive");
  });

  it("limits a regional manager to the stores of the linked regions", async () => {
    const { organizationId } = await createOrganizationFixture();
    const north = await createRegionFixture(organizationId);
    const south = await createRegionFixture(organizationId);
    const northStore = await createStoreFixture(organizationId, { regionId: north });
    await createStoreFixture(organizationId, { regionId: south });
    await createStoreFixture(organizationId);
    const manager = await addMemberFixture(organizationId, { roleKey: "regional_manager", regionIds: [north] });
    expect((await listStores(manager.context, filters())).rows.map((row) => row.id)).toEqual([northStore]);
    expect((await listStores(manager.context, filters({ regionId: south }))).total).toBe(0);
  });

  it("treats stores of another organization as not found", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const storeOfB = await createStoreFixture(b.organizationId, { name: "Loja de B" });
    expect(await getStore(a.owner, storeOfB)).toBeNull();
    expect((await listStores(a.owner, filters())).rows.map((row) => row.id)).not.toContain(storeOfB);
    await expect(updateStore(a.owner, storeOfB, storeInput({ name: "Sequestrada" }))).rejects.toMatchObject({ code: "not_found" });
    await expect(setStoreStatus(a.owner, storeOfB, "inactive")).rejects.toMatchObject({ code: "not_found" });
    expect(await storeRow(b.organizationId, storeOfB)).toMatchObject({ name: "Loja de B", status: "active" });
    expect(await getStore(a.owner, "nao-e-um-id")).toBeNull();
    await expect(updateStore(a.owner, "nao-e-um-id", storeInput())).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects regions of another organization or that do not exist", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const regionOfB = await createRegionFixture(b.organizationId);
    const expected = { code: "invalid", fieldErrors: { regionId: ["Selecione uma região da empresa."] } };
    await expect(createStore(a.owner, storeInput({ regionId: regionOfB }))).rejects.toMatchObject(expected);
    const created = await createStore(a.owner, storeInput());
    await expect(updateStore(a.owner, created.id, storeInput({ regionId: regionOfB }))).rejects.toMatchObject(expected);
    await expect(
      updateStore(a.owner, created.id, storeInput({ regionId: "00000000-0000-4000-8000-000000000000" })),
    ).rejects.toMatchObject(expected);
    expect((await storeRow(a.organizationId, created.id)).regionId).toBeNull();
  });

  it("enforces permissions in the service for members without stores.manage", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    expect((await listStores(seller.context, filters())).rows.map((row) => row.id)).toEqual([storeId]);
    await expect(createStore(seller.context, storeInput())).rejects.toMatchObject({ code: "forbidden" });
    await expect(setStoreStatus(seller.context, storeId, "inactive")).rejects.toMatchObject({ code: "forbidden" });
    await expect(getStorePlanUsage(seller.context)).rejects.toMatchObject({ code: "forbidden" });
    expect((await storeRow(organizationId, storeId)).status).toBe("active");
  });
});
