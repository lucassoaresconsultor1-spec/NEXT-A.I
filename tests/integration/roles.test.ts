import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, rolePermissions, roles } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { findSystemRole } from "@/server/authz/system-roles";
import { createRole, deleteRole, getRole, listRoles, updateRole } from "@/server/roles/service";
import { addMemberFixture, contextFor, createOrganizationFixture, createStoreFixture, uniqueSuffix } from "./fixtures";

// Direct reads bypass the service under test (same principle as fixtures.ts).
async function storedPermissions(organizationId: string, roleId: string) {
  const rows = await withScope({ organizationId }, (tx) =>
    tx
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.organizationId, organizationId), eq(rolePermissions.roleId, roleId))),
  );
  return rows.map((row) => row.permission).sort();
}

async function roleIdByKey(organizationId: string, key: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx.select({ id: roles.id }).from(roles).where(and(eq(roles.organizationId, organizationId), eq(roles.key, key))),
  );
  return row.id;
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

const sorted = (values: Iterable<string>) => [...values].sort();

/** Custom role holding only member/role management, assigned to a fresh member with all-store access. */
async function accessManagerFixture(organizationId: string, owner: Awaited<ReturnType<typeof createOrganizationFixture>>["owner"]) {
  const role = await createRole(owner, {
    name: `Gestor de acessos ${uniqueSuffix()}`,
    rank: 60,
    permissions: ["members.read", "roles.read", "roles.manage"],
  });
  return { role, member: await addMemberFixture(organizationId, { roleKey: role.key, storeAccess: "all" }) };
}

describe("roles service: custom roles", () => {
  it("creates a custom role whose members get exactly its permissions, with an audit entry", async () => {
    const { organizationId, ownerId, owner } = await createOrganizationFixture();
    const created = await createRole(owner, {
      name: "  Conferente ",
      description: "Recebimento de mercadorias",
      rank: 30,
      permissions: ["departments.read", "stores.read", "stores.read"],
    });
    expect(created.key).toBe("custom_conferente");
    expect(await storedPermissions(organizationId, created.id)).toEqual(["departments.read", "stores.read"]);

    const member = await addMemberFixture(organizationId, { roleKey: created.key, storeAccess: "all" });
    expect(member.context.role).toMatchObject({ id: created.id, isSystem: false, rank: 30 });
    expect(sorted(member.context.permissions)).toEqual(["departments.read", "stores.read"]);

    const detail = await getRole(owner, created.id);
    expect(detail).toMatchObject({ name: "Conferente", description: "Recebimento de mercadorias", isSystem: false, memberCount: 1 });
    expect(detail?.permissions).toEqual(["stores.read", "departments.read"]);

    const trail = await auditTrail(organizationId, created.id);
    expect(trail).toEqual([
      {
        action: "role.created",
        entityType: "role",
        actorUserId: ownerId,
        changes: {
          key: "custom_conferente",
          name: "Conferente",
          description: "Recebimento de mercadorias",
          rank: 30,
          permissions: ["stores.read", "departments.read"],
        },
      },
    ]);
  });

  it("lists every role by rank with system permissions from code and member counts", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const custom = await createRole(owner, { name: "Estoquista", rank: 25, permissions: ["stores.read"] });
    await addMemberFixture(organizationId, { roleKey: "admin" });
    const list = await listRoles(owner);
    expect(list.map((role) => role.key)).toEqual(["owner", "admin", "finance", "regional_manager", "store_manager", "supervisor", custom.key, "cashier", "salesperson"]);
    const byKey = new Map(list.map((role) => [role.key, role]));
    expect(byKey.get("owner")?.memberCount).toBe(1);
    expect(byKey.get("admin")?.memberCount).toBe(1);
    expect(byKey.get("cashier")?.memberCount).toBe(0);
    expect(sorted(byKey.get("store_manager")?.permissions ?? [])).toEqual(sorted(findSystemRole("store_manager")!.permissions));
    expect(byKey.get(custom.key)).toMatchObject({ isSystem: false, permissions: ["stores.read"] });
  });

  it("updates name, rank and permissions, audits the diff and applies it on the member's next request", async () => {
    const { organizationId, ownerId, owner } = await createOrganizationFixture();
    const created = await createRole(owner, { name: "Fiscal", rank: 30, permissions: ["stores.read", "departments.read"] });
    const member = await addMemberFixture(organizationId, { roleKey: created.key, storeAccess: "all" });

    await updateRole(owner, created.id, { name: "Fiscal de loja", rank: 35, permissions: ["stores.read", "members.read"] });
    expect(await storedPermissions(organizationId, created.id)).toEqual(["members.read", "stores.read"]);
    const refreshed = await contextFor(member.userId, organizationId);
    expect(sorted(refreshed.permissions)).toEqual(["members.read", "stores.read"]);
    expect(refreshed.role).toMatchObject({ name: "Fiscal de loja", rank: 35, key: created.key });

    const trail = await auditTrail(organizationId, created.id);
    expect(trail.map((entry) => entry.action)).toEqual(["role.created", "role.updated"]);
    expect(trail[1]).toMatchObject({ actorUserId: ownerId });
    expect(trail[1].changes).toEqual({
      name: { from: "Fiscal", to: "Fiscal de loja" },
      rank: { from: 30, to: 35 },
      permissions: { added: ["members.read"], removed: ["departments.read"] },
    });
  });

  it("adds a numeric suffix when the generated key is taken, per organization", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const first = await createRole(a.owner, { name: "Caixa Líder", rank: 25, permissions: ["stores.read"] });
    const second = await createRole(a.owner, { name: "caixa lider", rank: 25, permissions: ["stores.read"] });
    const third = await createRole(a.owner, { name: "CAIXA-LÍDER", rank: 25, permissions: ["stores.read"] });
    expect([first.key, second.key, third.key]).toEqual(["custom_caixa_lider", "custom_caixa_lider_2", "custom_caixa_lider_3"]);
    expect((await createRole(b.owner, { name: "Caixa Líder", rank: 25, permissions: ["stores.read"] })).key).toBe("custom_caixa_lider");
  });

  it("retries concurrent creations that race for the same key", async () => {
    const { owner } = await createOrganizationFixture();
    const created = await Promise.all(
      [1, 2, 3].map(() => createRole(owner, { name: "Promotor", rank: 20, permissions: ["stores.read"] })),
    );
    expect(sorted(created.map((role) => role.key))).toEqual(["custom_promotor", "custom_promotor_2", "custom_promotor_3"]);
  });

  it("validates input in the service", async () => {
    const { owner } = await createOrganizationFixture();
    await expect(createRole(owner, { name: "Sem permissões", rank: 10, permissions: [] })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { permissions: expect.any(Array) },
    });
    await expect(createRole(owner, { name: "Inventada", rank: 10, permissions: ["stores.delete_all"] })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { permissions: expect.any(Array) },
    });
    await expect(createRole(owner, { name: "X", rank: 10, permissions: ["stores.read"] })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { name: expect.any(Array) },
    });
    await expect(createRole(owner, { name: "Quebrado", rank: 0, permissions: ["stores.read"] })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { rank: expect.any(Array) },
    });
  });
});

describe("roles service: hierarchy and grants", () => {
  it("never grants a permission the actor does not hold", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const { member } = await accessManagerFixture(organizationId, owner);
    await expect(
      createRole(member.context, { name: "Auditor", rank: 10, permissions: ["members.read", "audit.read"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const allowed = await createRole(member.context, { name: "Leitor de equipe", rank: 50, permissions: ["members.read"] });
    expect(await storedPermissions(organizationId, allowed.id)).toEqual(["members.read"]);
    await expect(
      updateRole(member.context, allowed.id, { name: "Leitor de equipe", rank: 50, permissions: ["members.read", "audit.read"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps permissions the actor lacks unchanged when they edit a lower role", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const { member } = await accessManagerFixture(organizationId, owner);
    const target = await createRole(owner, { name: "Auditor de loja", rank: 40, permissions: ["audit.read", "stores.read"] });
    // The manager holds neither audit.read nor stores.read: unchecked (not submitted) does not revoke them.
    await updateRole(member.context, target.id, { name: "Auditor de loja", rank: 40, permissions: ["members.read"] });
    expect(await storedPermissions(organizationId, target.id)).toEqual(["audit.read", "members.read", "stores.read"]);
    // Clearing everything the manager controls is valid while kept permissions remain.
    await updateRole(member.context, target.id, { name: "Auditor de loja", rank: 40, permissions: [] });
    expect(await storedPermissions(organizationId, target.id)).toEqual(["audit.read", "stores.read"]);
  });

  it("blocks rank escalation for administrators and caps owners at 99", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const admin = await addMemberFixture(organizationId, { roleKey: "admin" });
    for (const rank of [90, 95]) {
      await expect(createRole(admin.context, { name: `Nível ${rank}`, rank, permissions: ["stores.read"] })).rejects.toMatchObject({
        code: "invalid",
        fieldErrors: { rank: expect.any(Array) },
      });
    }
    const below = await createRole(admin.context, { name: "Quase admin", rank: 89, permissions: ["stores.read"] });
    await expect(
      updateRole(admin.context, below.id, { name: "Quase admin", rank: 90, permissions: ["stores.read"] }),
    ).rejects.toMatchObject({ code: "invalid" });

    const top = await createRole(owner, { name: "Diretoria", rank: 99, permissions: ["stores.read"] });
    await expect(createRole(owner, { name: "Dono 2", rank: 100, permissions: ["stores.read"] })).rejects.toMatchObject({ code: "invalid" });
    // A role above the administrator cannot be changed or removed by them.
    await expect(updateRole(admin.context, top.id, { name: "Diretoria", rank: 80, permissions: ["stores.read"] })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(deleteRole(admin.context, top.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does not let members change the custom role they hold", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const { role, member } = await accessManagerFixture(organizationId, owner);
    await expect(
      updateRole(member.context, role.id, { name: "Gestor", rank: 59, permissions: ["members.read", "roles.read", "roles.manage"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteRole(member.context, role.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps system roles immutable and undeletable", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const salesperson = await roleIdByKey(organizationId, "salesperson");
    await expect(updateRole(owner, salesperson, { name: "Vendedor", rank: 20, permissions: ["stores.read", "audit.read"] })).rejects.toMatchObject({
      code: "forbidden",
      message: "Perfis do sistema não podem ser alterados.",
    });
    await expect(deleteRole(owner, salesperson)).rejects.toMatchObject({ code: "forbidden" });
    expect(await getRole(owner, salesperson)).toMatchObject({ isSystem: true, name: "Vendedor", permissions: ["stores.read", "catalog.read", "inventory.read"] });
    expect(await storedPermissions(organizationId, salesperson)).toEqual([]);
  });
});

describe("roles service: authorization and isolation", () => {
  it("enforces permissions in the service", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    await expect(listRoles(seller.context)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getRole(seller.context, randomUUID())).rejects.toMatchObject({ code: "forbidden" });
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] });
    await expect(createRole(manager.context, { name: "Ajudante", rank: 10, permissions: ["stores.read"] })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("requires organization-wide access to manage and hides counts from store-scoped viewers", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const { role } = await accessManagerFixture(organizationId, owner);
    const scoped = await addMemberFixture(organizationId, { roleKey: role.key, storeIds: [storeId] });
    await expect(createRole(scoped.context, { name: "Leitor", rank: 10, permissions: ["members.read"] })).rejects.toMatchObject({
      code: "forbidden",
    });
    const target = await createRole(owner, { name: "Alvo", rank: 10, permissions: ["members.read"] });
    await expect(updateRole(scoped.context, target.id, { name: "Alvo 2", rank: 10, permissions: ["members.read"] })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(deleteRole(scoped.context, target.id)).rejects.toMatchObject({ code: "forbidden" });
    const visible = await listRoles(scoped.context);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((entry) => entry.memberCount === null)).toBe(true);
    expect((await getRole(scoped.context, target.id))?.memberCount).toBeNull();
  });

  it("treats roles of another organization as not found", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const roleOfB = await createRole(b.owner, { name: "Exclusivo B", rank: 30, permissions: ["stores.read"] });
    const systemOfB = await roleIdByKey(b.organizationId, "cashier");
    expect((await listRoles(a.owner)).map((role) => role.id)).not.toContain(roleOfB.id);
    expect(await getRole(a.owner, roleOfB.id)).toBeNull();
    expect(await getRole(a.owner, systemOfB)).toBeNull();
    expect(await getRole(a.owner, "nao-e-um-uuid")).toBeNull();
    await expect(updateRole(a.owner, roleOfB.id, { name: "Sequestrado", rank: 30, permissions: ["stores.read"] })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(updateRole(a.owner, systemOfB, { name: "Sequestrado", rank: 30, permissions: ["stores.read"] })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteRole(a.owner, roleOfB.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteRole(a.owner, "nao-e-um-uuid")).rejects.toMatchObject({ code: "not_found" });
    expect(await getRole(b.owner, roleOfB.id)).toMatchObject({ name: "Exclusivo B" });
    expect(await storedPermissions(b.organizationId, roleOfB.id)).toEqual(["stores.read"]);
  });
});

describe("roles service: deletion", () => {
  it("refuses to delete a role in use and deletes an unused one with an audit entry", async () => {
    const { organizationId, ownerId, owner } = await createOrganizationFixture();
    const used = await createRole(owner, { name: "Repositor", rank: 15, permissions: ["stores.read"] });
    await addMemberFixture(organizationId, { roleKey: used.key, storeAccess: "all" });
    await expect(deleteRole(owner, used.id)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("1 membro(s)") });
    expect(await getRole(owner, used.id)).not.toBeNull();

    const unused = await createRole(owner, { name: "Temporário", rank: 15, permissions: ["stores.read", "departments.read"] });
    await deleteRole(owner, unused.id);
    expect(await getRole(owner, unused.id)).toBeNull();
    expect(await storedPermissions(organizationId, unused.id)).toEqual([]);
    const trail = await auditTrail(organizationId, unused.id);
    expect(trail.map((entry) => entry.action)).toEqual(["role.created", "role.deleted"]);
    expect(trail[1]).toEqual({
      action: "role.deleted",
      entityType: "role",
      actorUserId: ownerId,
      changes: { key: unused.key, name: "Temporário", rank: 15, permissions: ["stores.read", "departments.read"] },
    });
  });
});
