import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/feedback";
import { getCurrentSession } from "@/server/auth/session";
import { ChangePasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Alterar senha" };

export default async function ChangePasswordPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/entrar");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">Alterar senha</h1>
        <p className="text-sm text-ink-muted">As outras sessões abertas com esta conta serão encerradas.</p>
      </div>
      {session.user.mustChangePassword ? (
        <Notice tone="warning" title="Defina uma nova senha para continuar">
          Seu acesso foi criado com uma senha provisória.
        </Notice>
      ) : null}
      <ChangePasswordForm />
      {session.user.mustChangePassword ? null : (
        <Link href="/painel" className="block text-center text-sm font-medium text-brand hover:underline">
          Voltar ao painel
        </Link>
      )}
    </div>
  );
}
