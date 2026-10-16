import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/feedback";

export function RoleTypeBadge({ isSystem }: { isSystem: boolean }) {
  return isSystem ? <Badge tone="neutral">Sistema</Badge> : <Badge tone="brand">Personalizado</Badge>;
}

/** Check or cross with screen-reader text, so the meaning never depends on the icon alone. */
export function GrantMark({ granted }: { granted: boolean }) {
  return granted ? (
    <span className="inline-flex text-positive">
      <Check className="size-4" aria-hidden />
      <span className="sr-only">Permitido</span>
    </span>
  ) : (
    <span className="inline-flex text-ink-muted">
      <X className="size-4" aria-hidden />
      <span className="sr-only">Não permitido</span>
    </span>
  );
}
