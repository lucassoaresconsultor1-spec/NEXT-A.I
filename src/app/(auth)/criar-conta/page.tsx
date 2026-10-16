import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/feedback";
import { isSignupAllowed } from "@/lib/env";
import { getCurrentSession } from "@/server/auth/session";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignUpPage() {
  if (await getCurrentSession()) redirect("/painel");
  if (!isSignupAllowed()) {
    return (
      <div className="space-y-4">
        <Notice tone="info" title="Cadastro de novas empresas desativado">
          Solicite acesso ao administrador da plataforma.
        </Notice>
        <Link href="/entrar" className="text-sm font-medium text-brand hover:underline">
          Voltar para entrar
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">Criar conta da empresa</h1>
        <p className="text-sm text-ink-muted">
          A empresa começa no plano Essencial (uma loja). Você entra como dono e cadastra lojas e equipe em seguida.
        </p>
      </div>
      <SignUpForm />
    </div>
  );
}
