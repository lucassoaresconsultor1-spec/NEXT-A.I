import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  const result = manifest();

  it("describes the installable app with the brand colors", () => {
    expect(result).toMatchObject({
      name: "NEXT A.I",
      short_name: "NEXT A.I",
      lang: "pt-BR",
      start_url: "/painel",
      scope: "/",
      display: "standalone",
      theme_color: "#062F28",
      background_color: "#062F28",
    });
  });

  it("lists exactly the two official PNG icons", () => {
    expect(result.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ]);
    for (const icon of result.icons ?? []) expect(icon.src.startsWith("/icons/")).toBe(true);
  });

  it("points at icon files that exist in public/ and are not empty", () => {
    for (const icon of result.icons ?? []) {
      const file = join(process.cwd(), "public", icon.src);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    }
  });

  it("declares no shortcuts, screenshots or related applications", () => {
    expect(result).not.toHaveProperty("shortcuts");
    expect(result).not.toHaveProperty("screenshots");
    expect(result).not.toHaveProperty("related_applications");
  });
});
