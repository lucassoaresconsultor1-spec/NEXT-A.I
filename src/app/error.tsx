"use client";

// Generic boundary: the message never includes server details.
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold text-ink">Algo deu errado</h1>
      <p className="max-w-sm text-sm text-ink-muted">Não foi possível carregar esta página. Tente novamente; se persistir, avise o suporte.</p>
      <button type="button" onClick={retry} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong">
        Tentar novamente
      </button>
    </main>
  );
}
