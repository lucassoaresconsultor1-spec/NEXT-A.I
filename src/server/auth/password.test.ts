import { describe, expect, it } from "vitest";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";

const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correta-senha-123", FAST);
    expect(await verifyPassword("correta-senha-123", hash)).toBe(true);
    expect(await verifyPassword("correta-senha-124", hash)).toBe(false);
  });

  it("salts every hash and keeps its parameters in the encoding", async () => {
    const first = await hashPassword("mesma-senha-123", FAST);
    const second = await hashPassword("mesma-senha-123", FAST);
    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$1024$8$1$")).toBe(true);
  });

  it("uses the production parameters by default", async () => {
    expect((await hashPassword("padrao-senha-123")).startsWith("scrypt$65536$8$2$")).toBe(true);
  });

  it("treats Unicode-equivalent input as the same password", async () => {
    const hash = await hashPassword("café-senha-123", FAST);
    expect(await verifyPassword("café-senha-123", hash)).toBe(true);
  });

  it("rejects malformed or abusive stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1048577$8$1$c2FsdA==$a2V5")).toBe(false);
    expect(await verifyPassword("x", "scrypt$3000$8$1$c2FsdA==$a2V5")).toBe(false);
    expect(await verifyAgainstDummy("x")).toBe(false);
  });
});
