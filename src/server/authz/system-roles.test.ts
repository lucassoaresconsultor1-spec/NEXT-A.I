import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isPermission } from "./permissions";
import { OWNER_ROLE_KEY, SYSTEM_ROLES } from "./system-roles";

describe("system roles", () => {
  it("only reference permissions from the catalog", () => {
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) expect(isPermission(permission)).toBe(true);
    }
  });

  it("keep unique keys and a strict hierarchy below the owner", () => {
    expect(new Set(SYSTEM_ROLES.map((role) => role.key)).size).toBe(SYSTEM_ROLES.length);
    const owner = SYSTEM_ROLES.find((role) => role.key === OWNER_ROLE_KEY)!;
    expect(owner.permissions).toEqual(ALL_PERMISSIONS);
    expect(SYSTEM_ROLES.every((role) => role.key === OWNER_ROLE_KEY || role.rank < owner.rank)).toBe(true);
  });

  it("give front-line roles no management or audit access", () => {
    for (const key of ["salesperson", "cashier"]) {
      const role = SYSTEM_ROLES.find((entry) => entry.key === key)!;
      expect(role.permissions.some((permission) => permission.endsWith(".manage"))).toBe(false);
      expect(role.permissions).not.toContain("audit.read");
      expect(role.permissions).not.toContain("members.read");
    }
  });

  it("scope non-administrative roles below organization level by default", () => {
    for (const role of SYSTEM_ROLES.filter((entry) => !["owner", "admin"].includes(entry.key))) {
      expect(role.defaultStoreAccess).not.toBe("all");
    }
  });
});
