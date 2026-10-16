import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="text-xl font-semibold text-ink">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-ink-muted">O endereço não existe ou o registro não está disponível para o seu acesso.</p>
      <Link href="/painel" className="text-sm font-medium text-brand hover:underline">
        Ir para o painel
      </Link>
    </main>
  );
}
