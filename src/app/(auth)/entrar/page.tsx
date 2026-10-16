import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth/session";
import { isSignupAllowed } from "@/lib/env";
import { SignInForm } from "../auth-forms";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: PageProps<"/entrar">) {
  if (await getCurrentSession()) redirect("/painel");
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">Entrar</h1>
        <p className="text-sm text-ink-muted">Use o e-mail e a senha cadastrados pela sua empresa.</p>
      </div>
      <SignInForm next={typeof next === "string" ? next : undefined} />
      {isSignupAllowed() ? (
        <p className="text-center text-sm text-ink-muted">
          Sua empresa ainda não usa o sistema?{" "}
          <Link href="/criar-conta" className="font-medium text-brand hover:underline">
            Criar conta
          </Link>
        </p>
      ) : null}
    </div>
  );
}
