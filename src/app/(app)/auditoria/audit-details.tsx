// Compact, safe rendering of the `changes` JSON of an audit entry. Values are
// stringified defensively and truncated; nothing here is interpreted as HTML.

const FIELD_LABELS: Record<string, string> = {
  name: "nome",
  legalName: "razão social",
  document: "CNPJ",
  timezone: "fuso horário",
  plan: "plano",
  planKey: "plano",
  status: "situação",
  description: "descrição",
  code: "código",
  email: "e-mail",
  phone: "telefone",
  postalCode: "CEP",
  street: "logradouro",
  number: "número",
  complement: "complemento",
  district: "bairro",
  city: "cidade",
  state: "UF",
  regionId: "região",
  role: "perfil",
  roleId: "perfil",
  storeAccess: "acesso às lojas",
  isActive: "ativo",
  permissions: "permissões",
};

export const MAX_VALUE_LENGTH = 60;
export const MAX_LINES = 6;

function truncate(text: string, max = MAX_VALUE_LENGTH) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (Array.isArray(value)) return value.length === 0 ? "—" : truncate(value.map((item) => formatAuditValue(item)).join(", "));
  try {
    return truncate(JSON.stringify(value) ?? "—");
  } catch {
    return "…";
  }
}

function isFromTo(value: unknown): value is { from: unknown; to: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("from") && keys.includes("to");
}

/** One line per field: "campo: de → para" for diffs, "campo: valor" for flat values. */
export function describeChanges(changes: unknown): string[] {
  if (typeof changes !== "object" || changes === null || Array.isArray(changes)) return [];
  return Object.entries(changes).map(([field, value]) => {
    const label = FIELD_LABELS[field] ?? field;
    if (isFromTo(value)) return `${label}: ${formatAuditValue(value.from)} → ${formatAuditValue(value.to)}`;
    return `${label}: ${formatAuditValue(value)}`;
  });
}

export function AuditDetails({ changes }: { changes: unknown }) {
  const lines = describeChanges(changes);
  if (lines.length === 0) return <span className="text-ink-muted">—</span>;
  const visible = lines.slice(0, MAX_LINES);
  const hidden = lines.length - visible.length;
  return (
    <ul className="space-y-0.5 text-xs text-ink-soft">
      {visible.map((line, index) => (
        <li key={index} className="break-words">
          {line}
        </li>
      ))}
      {hidden > 0 ? <li className="text-ink-muted">+{hidden} campo(s)</li> : null}
    </ul>
  );
}
