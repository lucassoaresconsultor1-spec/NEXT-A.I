import { describe, expect, it } from "vitest";
import { CSV_LIMITS, decodeCsv, parseCsv } from "./csv";

const encode = (text: string) => new TextEncoder().encode(text);

describe("decodeCsv", () => {
  it("removes the BOM and refuses empty, binary, oversized and non UTF-8 files", () => {
    expect(decodeCsv(encode("﻿a;b"))).toEqual({ ok: true, text: "a;b" });
    expect(decodeCsv(new Uint8Array())).toMatchObject({ ok: false });
    expect(decodeCsv(new Uint8Array([97, 0, 98]))).toMatchObject({ ok: false, message: expect.stringContaining("texto") });
    expect(decodeCsv(new Uint8Array([0xc3, 0x28]))).toMatchObject({ ok: false, message: expect.stringContaining("UTF-8") });
    expect(decodeCsv(new Uint8Array(CSV_LIMITS.maxBytes + 1).fill(97))).toMatchObject({ ok: false, message: expect.stringContaining("2 MB") });
  });
});

describe("parseCsv", () => {
  it("detects ; and , and keeps quoted separators, escaped quotes and line breaks", () => {
    expect(parseCsv("nome;preco\nCamisa;12,90")).toEqual({ ok: true, separator: ";", header: ["nome", "preco"], rows: [{ line: 2, cells: ["Camisa", "12,90"] }] });
    const result = parseCsv('nome,obs\r\n"Silva, Ana","disse ""oi""\nem duas linhas"\r\nBeto,x');
    expect(result).toEqual({
      ok: true,
      separator: ",",
      header: ["nome", "obs"],
      rows: [
        { line: 2, cells: ["Silva, Ana", 'disse "oi"\nem duas linhas'] },
        { line: 4, cells: ["Beto", "x"] },
      ],
    });
  });

  it("skips blank lines, trims cells and never evaluates formulas", () => {
    expect(parseCsv("a;b\n\n  1 ; =SOMA(A1) \n\n")).toMatchObject({ rows: [{ line: 3, cells: ["1", "=SOMA(A1)"] }] });
  });

  it("refuses bad headers, unterminated quotes and the limits", () => {
    expect(parseCsv("a;;b\n1;2;3")).toMatchObject({ ok: false });
    expect(parseCsv("a;A\n1;2")).toMatchObject({ ok: false });
    expect(parseCsv("a;b")).toMatchObject({ ok: false });
    expect(parseCsv('a;b\n"1;2')).toMatchObject({ ok: false, message: expect.stringContaining("Aspas") });
    expect(parseCsv(`${Array.from({ length: 41 }, (_, i) => `c${i}`).join(";")}\n1`)).toMatchObject({ ok: false, message: expect.stringContaining("40") });
    expect(parseCsv(`a\n${"x".repeat(1001)}`)).toMatchObject({ ok: false, message: expect.stringContaining("1000") });
    expect(parseCsv(`a\n${"1\n".repeat(5001)}`)).toMatchObject({ ok: false, message: expect.stringContaining("5000") });
    expect(parseCsv(`a\n${"1\n".repeat(5000)}`)).toMatchObject({ ok: true });
  });
});
