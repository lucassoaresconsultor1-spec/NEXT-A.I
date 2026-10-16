import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/authz/context";
import type { Permission } from "@/server/authz/permissions";
import { findSystemRole } from "@/server/authz/system-roles";

vi.mock("server-only", () => ({}));

const {
  accessChanges,
  assertCanAssignRole,
  assertCanManage,
  assertKeepsActiveOwner,
  canAssignRole,
  isActiveOwner,
  manageBlock,
  removesLastActiveOwner,
  resolveScope,
  SELF_CHANGE_MESSAGE,
} = await import("./rules");

const STORE_A = "00000000-0000-4000-8000-00000000000a";
const STORE_B = "00000000-0000-4000-8000-00000000000b";
const REGION_N = "00000000-0000-4000-8000-0000000000e1";

function systemRole(key: string) {
  const role = findSystemRole(key);
  if (!role) throw new Error(`unknown role ${key}`);
  return { key: role.key, isSystem: true, rank: role.rank, permissions: role.permissions };
}

function contextAs(roleKey: string, storeIds: string[] | "all" = "all"): TenantContext {
  const role = findSystemRole(roleKey)!;
  return {
    sessionId: "session",
    user: { id: "user-actor", email: "actor@example.test", name: "Ator", isPlatformAdmin: false, mustChangePassword: false },
    organization: { id: "org", name: "Empresa", planKey: "essencial", timezone: "America/Sao_Paulo" },
    membershipId: "membership-actor",
    role: { id: `role-${roleKey}`, key: role.key, name: role.name, rank: role.rank, isSystem: true },
    permissions: new Set<Permission>(role.permissions),
    storeAccess: storeIds === "all" ? "all" : "stores",
    storeScope: storeIds === "all" ? { all: true } : { all: false, storeIds },
    activeStoreId: null,
  };
}

function target(roleKey: string, values: Partial<{ membershipId: string; storeIds: string[]; storeAccess: "all" | "regions" | "stores"; status: "active" | "suspended" }> = {}) {
  return {
    membershipId: values.membershipId ?? "membership-target",
    status: values.status ?? "active",
    storeAccess: values.storeAccess ?? (values.storeIds ? "stores" : "all"),
    storeIds: values.storeIds ?? [],
    role: systemRole(roleKey),
  } as const;
}

function errorOf(work: () => unknown) {
  try {
    work();
  } catch (error) {
    return error as Error & { code?: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error("expected an error");
}

const known = (regionIds: string[] = [], storeIds: string[] = []) => ({ regionIds: new Set(regionIds), storeIds: new Set(storeIds) });

describe("role assignment", () => {
  it("lets owners assign any role, including owner", () => {
    const owner = contextAs("owner");
    for (const key of ["owner", "admin", "regional_manager", "store_manager", "cashier"]) {
      expect(canAssignRole(owner, systemRole(key))).toBe(true);
    }
  });

  it("limits other roles to strictly lower ranks and never the owner role", () => {
    const admin = contextAs("admin");
    expect(canAssignRole(admin, systemRole("owner"))).toBe(false);
    expect(canAssignRole(admin, systemRole("admin"))).toBe(false);
    expect(canAssignRole(admin, systemRole("regional_manager"))).toBe(true);
    const manager = contextAs("store_manager", [STORE_A]);
    for (const key of ["owner", "admin", "regional_manager", "store_manager"]) {
      expect(canAssignRole(manager, systemRole(key))).toBe(false);
    }
    expect(canAssignRole(manager, systemRole("supervisor"))).toBe(true);
    expect(canAssignRole(manager, systemRole("salesperson"))).toBe(true);
  });

  it("refuses a custom role marked with the owner key only when it is the system owner role", () => {
    const admin = contextAs("admin");
    expect(canAssignRole(admin, { key: "owner", isSystem: false, rank: 10, permissions: ["stores.read"] })).toBe(true);
    expect(() => assertCanAssignRole(admin, systemRole("owner"))).toThrow(/Somente proprietários/);
    expect(() => assertCanAssignRole(contextAs("store_manager", [STORE_A]), systemRole("store_manager"))).toThrowError(
      expect.objectContaining({ code: "forbidden", fieldErrors: expect.objectContaining({ roleId: expect.any(Array) }) }),
    );
  });
});

describe("who can be managed", () => {
  it("blocks every change to one's own membership", () => {
    const owner = contextAs("owner");
    const self = target("owner", { membershipId: owner.membershipId });
    expect(manageBlock(owner, self)).toBe("self");
    expect(() => assertCanManage(owner, self)).toThrow(SELF_CHANGE_MESSAGE);
  });

  it("requires a strictly lower rank, except for owners", () => {
    expect(manageBlock(contextAs("owner"), target("owner"))).toBeNull();
    expect(manageBlock(contextAs("admin"), target("owner"))).toBe("rank");
    expect(manageBlock(contextAs("admin"), target("admin"))).toBe("rank");
    expect(manageBlock(contextAs("admin"), target("store_manager", { storeIds: [STORE_B] }))).toBeNull();
    expect(manageBlock(contextAs("store_manager", [STORE_A]), target("store_manager", { storeIds: [STORE_A] }))).toBe("rank");
  });

  it("requires members.manage", () => {
    expect(manageBlock(contextAs("supervisor", [STORE_A]), target("salesperson", { storeIds: [STORE_A] }))).toBe("permission");
  });

  it("keeps scoped managers to store-level members fully inside their scope", () => {
    const manager = contextAs("store_manager", [STORE_A]);
    expect(manageBlock(manager, target("salesperson", { storeIds: [STORE_A] }))).toBeNull();
    expect(manageBlock(manager, target("salesperson", { storeIds: [STORE_A, STORE_B] }))).toBe("scope");
    expect(manageBlock(manager, target("salesperson", { storeAccess: "regions" }))).toBe("scope");
    expect(manageBlock(manager, target("salesperson", { storeAccess: "all" }))).toBe("scope");
  });
});

describe("scope resolution", () => {
  const owner = contextAs("owner");
  const manager = contextAs("store_manager", [STORE_A]);

  it("normalizes links to the chosen access mode", () => {
    expect(resolveScope(owner, { storeAccess: "all", regionIds: [REGION_N], storeIds: [STORE_A] }, known())).toEqual({
      storeAccess: "all",
      regionIds: [],
      storeIds: [],
    });
    expect(
      resolveScope(owner, { storeAccess: "regions", regionIds: [REGION_N, REGION_N], storeIds: [STORE_A] }, known([REGION_N])),
    ).toEqual({ storeAccess: "regions", regionIds: [REGION_N], storeIds: [] });
    expect(resolveScope(manager, { storeAccess: "stores", regionIds: [REGION_N], storeIds: [STORE_A] }, known([], [STORE_A]))).toEqual({
      storeAccess: "stores",
      regionIds: [],
      storeIds: [STORE_A],
    });
  });

  it("reserves 'all' and 'regions' to organization-wide actors", () => {
    expect(() => resolveScope(manager, { storeAccess: "all", regionIds: [], storeIds: [] }, known())).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(() => resolveScope(manager, { storeAccess: "regions", regionIds: [REGION_N], storeIds: [] }, known([REGION_N]))).toThrowError(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("requires at least one valid link of the organization", () => {
    expect(() => resolveScope(owner, { storeAccess: "regions", regionIds: [], storeIds: [] }, known())).toThrowError(
      expect.objectContaining({ code: "invalid", fieldErrors: { regionIds: expect.any(Array) } }),
    );
    expect(() => resolveScope(owner, { storeAccess: "regions", regionIds: [REGION_N], storeIds: [] }, known())).toThrowError(
      expect.objectContaining({ code: "invalid" }),
    );
    expect(() => resolveScope(owner, { storeAccess: "stores", regionIds: [], storeIds: [] }, known())).toThrowError(
      expect.objectContaining({ code: "invalid", fieldErrors: { storeIds: expect.any(Array) } }),
    );
    expect(() => resolveScope(owner, { storeAccess: "stores", regionIds: [], storeIds: [STORE_B] }, known())).toThrowError(
      expect.objectContaining({ code: "invalid" }),
    );
  });

  it("only grants stores inside the actor's scope, answering like an unknown store", () => {
    const outside = errorOf(() =>
      resolveScope(manager, { storeAccess: "stores", regionIds: [], storeIds: [STORE_A, STORE_B] }, known([], [STORE_A, STORE_B])),
    );
    const unknown = errorOf(() => resolveScope(manager, { storeAccess: "stores", regionIds: [], storeIds: [STORE_B] }, known([], [STORE_A])));
    expect(outside).toMatchObject({ code: "invalid", fieldErrors: { storeIds: expect.any(Array) } });
    expect({ ...outside, message: outside.message }).toEqual({ ...unknown, message: unknown.message });
    expect(resolveScope(owner, { storeAccess: "stores", regionIds: [], storeIds: [STORE_B] }, known([], [STORE_B])).storeIds).toEqual([STORE_B]);
  });
});

describe("owner invariant", () => {
  it("detects the change that would remove the last active owner", () => {
    expect(removesLastActiveOwner(true, false, 1)).toBe(true);
    expect(removesLastActiveOwner(true, false, 2)).toBe(false);
    expect(removesLastActiveOwner(true, true, 1)).toBe(false);
    expect(removesLastActiveOwner(false, false, 1)).toBe(false);
    expect(() => assertKeepsActiveOwner(true, false, 1)).toThrowError(expect.objectContaining({ code: "conflict" }));
    expect(() => assertKeepsActiveOwner(true, false, 2)).not.toThrow();
  });

  it("only counts active system owners", () => {
    expect(isActiveOwner(target("owner"))).toBe(true);
    expect(isActiveOwner(target("owner", { status: "suspended" }))).toBe(false);
    expect(isActiveOwner({ status: "active", role: { key: "owner", isSystem: false, rank: 100 } })).toBe(false);
    expect(isActiveOwner(target("admin"))).toBe(false);
  });
});

describe("access audit diff", () => {
  const entry = (id: string, name = id) => ({ id, name });
  const before = { role: entry("r1", "Vendedor"), storeAccess: "stores" as const, regions: [], stores: [entry("s2", "Loja B"), entry("s1", "Loja A")] };

  it("ignores link order and reports changes by label", () => {
    expect(accessChanges(before, { ...before, stores: [entry("s1", "Loja A"), entry("s2", "Loja B")] })).toEqual({});
    expect(accessChanges(before, { role: entry("r2", "Supervisor"), storeAccess: "regions", regions: [entry("n", "Norte")], stores: [] })).toEqual({
      role: { from: "Vendedor", to: "Supervisor" },
      storeAccess: { from: "stores", to: "regions" },
      regions: { from: [], to: ["Norte"] },
      stores: { from: ["Loja A", "Loja B"], to: [] },
    });
  });

  it("detects a swap between stores with the same label", () => {
    const swapped = accessChanges(
      { ...before, stores: [entry("s1", "Centro")] },
      { ...before, stores: [entry("s3", "Centro")] },
    );
    expect(Object.keys(swapped)).toEqual(["stores"]);
  });
});

describe("permissions carried by an assigned role", () => {
  it("refuses a lower-rank custom role holding permissions the actor lacks", () => {
    const manager = contextAs("store_manager", [STORE_A]);
    const auditor = { key: "custom_auditor", isSystem: false, rank: 10, permissions: ["stores.read", "audit.read"] };
    expect(canAssignRole(manager, auditor)).toBe(false);
    expect(() => assertCanAssignRole(manager, auditor)).toThrow(/permissões que você não possui/);
    expect(canAssignRole(manager, { ...auditor, permissions: ["stores.read", "members.read"] })).toBe(true);
  });

  it("lets owners assign any role", () => {
    const owner = contextAs("owner");
    expect(canAssignRole(owner, { key: "custom_x", isSystem: false, rank: 99, permissions: ["audit.read"] })).toBe(true);
  });
});
