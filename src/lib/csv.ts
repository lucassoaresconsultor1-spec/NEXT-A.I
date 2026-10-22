// Minimal CSV reader (ADR-019, no dependency): UTF-8 with or without BOM, ";" or ","
// detected from the header line, double quotes with "" escapes and line breaks inside
// quotes, CRLF or LF. Pure and safe for the browser (header preview) and the server.
// Cells are plain text: nothing is evaluated (no formulas).

export const CSV_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 5000, maxColumns: 40, maxCell: 1000 } as const;

export type CsvSeparator = ";" | ",";

export interface CsvRow {
  /** Line of the file where the record starts (the header is line 1). */
  line: number;
  cells: string[];
}

export type CsvResult = { ok: true; separator: CsvSeparator; header: string[]; rows: CsvRow[] } | { ok: false; message: string };

const fail = (message: string): CsvResult => ({ ok: false, message });

/** Bytes to text: refuses oversized, binary (NUL bytes) and invalid UTF-8; removes the BOM. */
export function decodeCsv(bytes: Uint8Array): { ok: true; text: string } | { ok: false; message: string } {
  if (bytes.length === 0) return { ok: false, message: "O arquivo está vazio." };
  if (bytes.length > CSV_LIMITS.maxBytes) return { ok: false, message: "O arquivo passa de 2 MB." };
  if (bytes.includes(0)) return { ok: false, message: "O arquivo não é um CSV de texto." };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, message: "O arquivo não está em UTF-8. Salve a planilha como \"CSV UTF-8\"." };
  }
  return { ok: true, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
}

/** ";" unless the first line has more "," than ";" outside quotes. */
export function detectSeparator(text: string): CsvSeparator {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char === ";") semicolons += 1;
    else if (!quoted && char === ",") commas += 1;
  }
  return commas > semicolons ? "," : ";";
}

/** Parses the whole text; blank lines are skipped and cells are trimmed. */
export function parseCsv(text: string): CsvResult {
  const separator = detectSeparator(text);
  const records: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let touched = false;

  const endCell = () => {
    cells.push(cell.trim());
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (touched || cells.some((value) => value !== "")) records.push({ line: start, cells });
    cells = [];
    touched = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      quoted = true;
      touched = true;
      cell = "";
    } else if (char === separator) {
      touched = true;
      endCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      endRecord();
      line += 1;
      start = line;
    } else cell += char;
    if (cell.length > CSV_LIMITS.maxCell) return fail(`A linha ${start} tem uma célula com mais de ${CSV_LIMITS.maxCell} caracteres.`);
    if (records.length > CSV_LIMITS.maxRows + 1) return fail(`O arquivo passa de ${CSV_LIMITS.maxRows} linhas.`);
  }
  if (quoted) return fail(`Aspas sem fechamento a partir da linha ${start}.`);
  endRecord();

  const [header, ...rows] = records;
  if (!header) return fail("O arquivo está vazio.");
  if (header.cells.length > CSV_LIMITS.maxColumns) return fail(`O arquivo passa de ${CSV_LIMITS.maxColumns} colunas.`);
  if (header.cells.some((name) => name === "")) return fail("O cabeçalho tem coluna sem nome.");
  if (new Set(header.cells.map((name) => name.toLowerCase())).size !== header.cells.length) return fail("O cabeçalho tem colunas com o mesmo nome.");
  if (rows.length === 0) return fail("O arquivo não tem linhas depois do cabeçalho.");
  if (rows.length > CSV_LIMITS.maxRows) return fail(`O arquivo passa de ${CSV_LIMITS.maxRows} linhas.`);
  return { ok: true, separator, header: header.cells, rows };
}

// ---- Writing (m18 reports) ----

/** Text (protected against formulas), integer, money in cents, or a decimal string ("1.75"). */
export type CsvCell = string | number | { cents: number } | { decimal: string } | null;

function centsText(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  return `${sign}${Math.trunc(value / 100)},${String(value % 100).padStart(2, "0")}`;
}

function cellText(cell: CsvCell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "object") return "cents" in cell ? centsText(cell.cents) : cell.decimal.replace(".", ",");
  // A spreadsheet would run text starting with these characters as a formula.
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/** UTF-8 CSV with BOM, ";" separator and CRLF, as Brazilian spreadsheets open it. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const line = (cells: CsvCell[]) =>
    cells
      .map((cell) => {
        const text = cellText(cell);
        return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(";");
  return `﻿${[line(header), ...rows.map(line)].join("\r\n")}\r\n`;
}
