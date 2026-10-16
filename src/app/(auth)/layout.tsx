export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Varejo Inteligente</p>
        <p className="mt-1 text-sm text-ink-muted">Gestão de lojas, equipes e operação</p>
      </div>
      <main className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
        {children}
      </main>
    </div>
  );
}
