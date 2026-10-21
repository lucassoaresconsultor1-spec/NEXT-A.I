"use client";

import { AlertTriangle } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title="Não foi possível carregar esta página"
          description="Tente novamente. Se o problema continuar, avise o suporte informando o código abaixo."
          action={(
            <div className="flex flex-col items-center gap-4">
              {typeof digest === "string" ? (
                <p className="font-mono text-xs text-ink-muted">Código: {digest}</p>
              ) : null}
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={retry}>Tentar novamente</Button>
                <LinkButton href="/painel" variant="secondary">Voltar ao painel</LinkButton>
              </div>
            </div>
          )}
        />
      </Card>
    </div>
  );
}