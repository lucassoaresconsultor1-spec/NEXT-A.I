import { describe, expect, it } from "vitest";
import {
  diffPermissions,
  MAX_CUSTOM_ROLE_RANK,
  maxAssignableRank,
  nextAvailableKey,
  rankError,
  resolveRolePermissions,
  roleInputSchema,
  roleKeyBase,
} from "./schemas";

describe("roleKeyBase", () => {
  it("slugs names to ASCII lowercase with underscores and the custom prefix", () => {
    expect(roleKeyBase("Conferente de Mercadorias")).toBe("custom_conferente_de_mercadorias");
    expect(roleKeyBase("  Gerente Sênior / Noite!  ")).toBe("custom_gerente_senior_noite");
    expect(roleKeyBase("Ação & Promoção")).toBe("custom_acao_promocao");
  });

  it("falls back when nothing usable remains and fits the 48-character column with a suffix", () => {
    expect(roleKeyBase("!!!")).toBe("custom_perfil");
    const long = roleKeyBase("a".repeat(31) + " bbbbbbbbbb");
    expect(long.length).toBeLessThanOrEqual(39);
    expect(long.endsWith("_")).toBe(false);
    expect(`${long}_99999999`.length).toBeLessThanOrEqual(48);
  });
});

describe("nextAvailableKey", () => {
  it("keeps the base when free and adds the first free numeric suffix otherwise", () => {
    expect(nextAvailableKey("custom_caixa", new Set())).toBe("custom_caixa");
    expect(nextAvailableKey("custom_caixa", new Set(["custom_caixa"]))).toBe("custom_caixa_2");
    expect(nextAvailableKey("custom_caixa", new Set(["custom_caixa", "custom_caixa_2", "custom_caixa_3"]))).toBe("custom_caixa_4");
    expect(nextAvailableKey("custom_caixa", new Set(["custom_caixa_2"]))).toBe("custom_caixa");
  });
});

describe("rank rules", () => {
  const admin = { rank: 90, isOwner: false };
  const owner = { rank: 100, isOwner: true };

  it("limits non-owners to ranks strictly below their own", () => {
    expect(maxAssignableRank(admin)).toBe(89);
    expect(rankError(89, admin)).toBeNull();
    expect(rankError(90, admin)).toMatch(/menor que o do seu perfil/);
    expect(rankError(95, admin)).not.toBeNull();
  });

  it("lets owners go up to 99 but never 100", () => {
    expect(maxAssignableRank(owner)).toBe(MAX_CUSTOM_ROLE_RANK);
    expect(rankError(99, owner)).toBeNull();
    expect(rankError(100, owner)).not.toBeNull();
  });

  it("rejects non-integer and non-positive ranks, and actors at the bottom", () => {
    expect(rankError(0, owner)).not.toBeNull();
    expect(rankError(2.5, owner)).not.toBeNull();
    expect(maxAssignableRank({ rank: 1, isOwner: false })).toBe(0);
    expect(rankError(1, { rank: 1, isOwner: false })).toMatch(/não permite/);
  });
});

describe("resolveRolePermissions", () => {
  const held = new Set(["members.read", "roles.read", "roles.manage"]);

  it("reports requested permissions the actor does not hold", () => {
    expect(resolveRolePermissions(["members.read", "audit.read"], held)).toEqual({ next: ["members.read"], granted: ["audit.read"] });
    expect(resolveRolePermissions(["members.read", "roles.read", "members.read"], held)).toEqual({
      next: ["members.read", "roles.read"],
      granted: [],
    });
  });

  it("keeps permissions the actor lacks exactly as the role already has them", () => {
    const current = ["members.read", "audit.read"];
    // Not submitted (disabled checkbox) -> kept; re-submitted -> not a new grant.
    expect(resolveRolePermissions(["roles.read"], held, current)).toEqual({ next: ["roles.read", "audit.read"], granted: [] });
    expect(resolveRolePermissions(["audit.read"], held, current)).toEqual({ next: ["audit.read"], granted: [] });
  });
});

describe("diffPermissions", () => {
  it("lists added and removed permissions", () => {
    expect(diffPermissions(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
    expect(diffPermissions(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });
});

describe("roleInputSchema", () => {
  it("parses form strings and trims text", () => {
    const parsed = roleInputSchema.parse({ name: "  Conferente ", description: "", rank: "30", permissions: ["stores.read"] });
    expect(parsed).toEqual({ name: "Conferente", description: undefined, rank: 30, permissions: ["stores.read"] });
  });

  it("returns field errors keyed by form field", () => {
    const result = roleInputSchema.safeParse({ name: "A", rank: "" });
    expect(result.success).toBe(false);
    const fields = result.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["name", "rank", "permissions"]));
    // An empty selection is shape-valid; the service checks the final set (kept permissions included).
    expect(roleInputSchema.safeParse({ name: "Perfil", rank: "10", permissions: [] }).success).toBe(true);
    expect(roleInputSchema.safeParse({ name: "Perfil", rank: "100", permissions: ["x"] }).success).toBe(false);
    expect(roleInputSchema.safeParse({ name: "Perfil", rank: "12.5", permissions: ["x"] }).success).toBe(false);
  });
});
