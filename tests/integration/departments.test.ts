import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, departments } from "@/db/schema";
import { withScope } from "@/db/tenant";
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  setDepartmentActive,
  updateDepartment,
} from "@/server/departments/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, uniqueSuffix } from "./fixtures";

// Direct insert, bypassing the service under test (same principle as fixtures.ts).
async function insertDepartment(organizationId: string, name: string, values: { description?: string; isActive?: boolean } = {}) {
  return withScope({ organizationId }, async (tx) => {
    const [row] = await tx
      .insert(departments)
      .values({ organizationId, name, description: values.description ?? null, isActive: values.isActive ?? true })
      .returning({ id: departments.id });
    return row.id;
  });
}

async function readDepartment(organizationId: string, id: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx
      .select({ name: departments.name, description: departments.description, isActive: departments.isActive })
      .from(departments)
      .where(and(eq(departments.organizationId, organizationId), eq(departments.id, id))),
  );
  return row ?? null;
}

async function auditTrail(organizationId: string, entityId: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ action: auditLogs.action, entityType: auditLogs.entityType, actorUserId: auditLogs.actorUserId, changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, entityId)))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

describe("departments service: lifecycle", () => {
  it("creates, lists, updates, toggles and deletes with an audit entry for each change", async () => {
    const { organizationId, ownerId, owner } = await createOrganizationFixture();
    const created = await createDepartment(owner, { name: "  Eletro  ", description: "Linha branca e portáteis" });
    expect(await readDepartment(organizationId, created.id)).toEqual({
      name: "Eletro",
      description: "Linha branca e portáteis",
      isActive: true,
    });

    await updateDepartment(owner, created.id, { name: "Eletrodomésticos", description: undefined });
    expect(await readDepartment(organizationId, created.id)).toMatchObject({ name: "Eletrodomésticos", description: null });

    await setDepartmentActive(owner, created.id, false);
    expect((await readDepartment(organizationId, created.id))?.isActive).toBe(false);
    await setDepartmentActive(owner, created.id, true);
    expect((await readDepartment(organizationId, created.id))?.isActive).toBe(true);

    await deleteDepartment(owner, created.id);
    expect(await readDepartment(organizationId, created.id)).toBeNull();
    expect((await listDepartments(owner)).map((row) => row.id)).not.toContain(created.id);

    const trail = await auditTrail(organizationId, created.id);
    expect(trail.map((entry) => entry.action)).toEqual([
      "department.created",
      "department.updated",
      "department.updated",
      "department.updated",
      "department.deleted",
    ]);
    expect(trail.every((entry) => entry.entityType === "department" && entry.actorUserId === ownerId)).toBe(true);
    expect(trail[0].changes).toEqual({ name: "Eletro", description: "Linha branca e portáteis" });
    expect(trail[1].changes).toEqual({
      name: { from: "Eletro", to: "Eletrodomésticos" },
      description: { from: "Linha branca e portáteis", to: null },
    });
    expect(trail[2].changes).toEqual({ isActive: { from: true, to: false } });
    expect(trail[3].changes).toEqual({ isActive: { from: false, to: true } });
    expect(trail[4].changes).toMatchObject({ name: "Eletrodomésticos" });
  });

  it("lists by name and filters by situation", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    await insertDepartment(organizationId, "Móveis");
    await insertDepartment(organizationId, "Celulares");
    await insertDepartment(organizationId, "Antigo", { isActive: false });
    expect((await listDepartments(owner)).map((row) => row.name)).toEqual(["Antigo", "Celulares", "Móveis"]);
    expect((await listDepartments(owner, { status: "active" })).map((row) => row.name)).toEqual(["Celulares", "Móveis"]);
    expect((await listDepartments(owner, { status: "inactive" })).map((row) => row.name)).toEqual(["Antigo"]);
  });

  it("does not write anything when nothing changes", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const id = await insertDepartment(organizationId, "Informática", { description: "Notebooks" });
    await updateDepartment(owner, id, { name: "Informática", description: "Notebooks" });
    await setDepartmentActive(owner, id, true);
    expect(await auditTrail(organizationId, id)).toEqual([]);
  });
});

describe("departments service: validation and uniqueness", () => {
  it("rejects invalid names and descriptions with field errors", async () => {
    const { owner } = await createOrganizationFixture();
    await expect(createDepartment(owner, { name: "A" })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { name: [expect.any(String)] },
    });
    await expect(createDepartment(owner, { name: "x".repeat(81) })).rejects.toMatchObject({ code: "invalid" });
    await expect(createDepartment(owner, { name: "Válido", description: "d".repeat(241) })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { description: [expect.any(String)] },
    });
    expect(await listDepartments(owner)).toEqual([]);
  });

  it("enforces case-insensitive unique names within the organization only", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const first = await createDepartment(a.owner, { name: "Celulares" });
    await expect(createDepartment(a.owner, { name: "CELULARES" })).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { name: ["Nome já utilizado."] },
    });
    const other = await createDepartment(a.owner, { name: "Games" });
    await expect(updateDepartment(a.owner, other.id, { name: "celulares" })).rejects.toMatchObject({ code: "conflict" });
    expect(await readDepartment(a.organizationId, other.id)).toMatchObject({ name: "Games" });

    // Renaming a department to a different casing of its own name is allowed.
    await updateDepartment(a.owner, first.id, { name: "celulares" });
    expect(await readDepartment(a.organizationId, first.id)).toMatchObject({ name: "celulares" });

    // The same name is free in another organization.
    const inB = await createDepartment(b.owner, { name: "Celulares" });
    expect((await listDepartments(b.owner)).map((row) => row.id)).toEqual([inB.id]);
  });
});

describe("departments service: tenant isolation", () => {
  it("treats another organization's department as not found and leaves it unchanged", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const ofB = await insertDepartment(b.organizationId, "Departamento B", { description: "Original" });
    expect((await listDepartments(a.owner)).map((row) => row.id)).not.toContain(ofB);

    await expect(updateDepartment(a.owner, ofB, { name: "Sequestrado" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setDepartmentActive(a.owner, ofB, false)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteDepartment(a.owner, ofB)).rejects.toMatchObject({ code: "not_found" });

    expect(await readDepartment(b.organizationId, ofB)).toEqual({ name: "Departamento B", description: "Original", isActive: true });
    expect(await auditTrail(a.organizationId, ofB)).toEqual([]);
    expect(await auditTrail(b.organizationId, ofB)).toEqual([]);
  });

  it("answers unknown or malformed ids as not found", async () => {
    const { owner } = await createOrganizationFixture();
    await expect(updateDepartment(owner, randomUUID(), { name: "Fantasma" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setDepartmentActive(owner, "not-a-uuid", false)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteDepartment(owner, randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("departments service: authorization", () => {
  it("lets a store manager list departments but not change them", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const id = await insertDepartment(organizationId, `Cama e banho ${uniqueSuffix()}`);
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] });

    expect((await listDepartments(manager.context)).map((row) => row.id)).toEqual([id]);
    await expect(createDepartment(manager.context, { name: "Proibido" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateDepartment(manager.context, id, { name: "Proibido" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setDepartmentActive(manager.context, id, false)).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteDepartment(manager.context, id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await readDepartment(organizationId, id)).toMatchObject({ isActive: true });
    expect(await auditTrail(organizationId, id)).toEqual([]);
  });

  it("denies a salesperson both reading and managing", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const id = await insertDepartment(organizationId, "Calçados");
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    await expect(listDepartments(seller.context)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createDepartment(seller.context, { name: "Proibido" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteDepartment(seller.context, id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await readDepartment(organizationId, id)).not.toBeNull();
  });

  it("requires organization-wide store access to manage, even with the permission", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const id = await insertDepartment(organizationId, "Perfumaria");
    const scopedAdmin = await addMemberFixture(organizationId, { roleKey: "admin", storeAccess: "stores", storeIds: [storeId] });
    const fullAdmin = await addMemberFixture(organizationId, { roleKey: "admin", storeAccess: "all" });

    expect((await listDepartments(scopedAdmin.context)).map((row) => row.id)).toEqual([id]);
    await expect(createDepartment(scopedAdmin.context, { name: "Escopo" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setDepartmentActive(scopedAdmin.context, id, false)).rejects.toMatchObject({ code: "forbidden" });

    await setDepartmentActive(fullAdmin.context, id, false);
    const trail = await auditTrail(organizationId, id);
    expect(trail).toEqual([
      { action: "department.updated", entityType: "department", actorUserId: fullAdmin.userId, changes: { isActive: { from: true, to: false } } },
    ]);
  });
});
