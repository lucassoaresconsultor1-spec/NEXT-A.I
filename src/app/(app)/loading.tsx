export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Carregando…</span>
      <div className="h-6 w-48 animate-pulse rounded bg-line" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
      <div className="h-64 animate-pulse rounded-[var(--radius-card)] border border-line bg-surface" />
    </div>
  );
}
