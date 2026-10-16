import { ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";

/** Rendered when the member lacks the permission; the server already refused the data. */
export function AccessDenied({ detail }: { detail?: string }) {
  return (
    <Card>
      <EmptyState
        icon={ShieldAlert}
        title="Acesso não permitido"
        description={detail ?? "Seu perfil não inclui esta área. Fale com um administrador da empresa se precisar do acesso."}
        action={<LinkButton href="/painel" variant="secondary">Voltar ao painel</LinkButton>}
      />
    </Card>
  );
}
