// Grants platform administration to a user, creating the account if needed.
// Usage: pnpm platform:admin <email>
//   PLATFORM_ADMIN_PASSWORD (>= 10 characters) is required only to create a new user;
//   PLATFORM_ADMIN_NAME is optional. The password is never printed.
import { loadEnvConfig } from "@next/env";
import { emailField, passwordField, requiredText } from "@/server/forms";

const silentEnvLog = { info: () => undefined, error: () => undefined };

const nameField = requiredText("o nome do administrador", 120, 2);

class UsageError extends Error {}

async function main() {
  // Before any module that reads the environment (database URL, log level).
  loadEnvConfig(process.cwd(), false, silentEnvLog);

  const email = emailField.safeParse(process.argv[2]);
  if (!email.success) throw new UsageError("Informe um e-mail válido. Uso: pnpm platform:admin <email>");

  const { eq } = await import("drizzle-orm");
  const { closeDatabase, getDb } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { hashPassword } = await import("@/server/auth/password");
  const { isUniqueViolation } = await import("@/server/errors");

  try {
    const db = getDb();
    const [existing] = await db
      .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.email, email.data));
    if (existing) {
      if (!existing.isPlatformAdmin) {
        await db.update(users).set({ isPlatformAdmin: true, updatedAt: new Date() }).where(eq(users.id, existing.id));
      }
      process.stdout.write(
        existing.isPlatformAdmin
          ? `${email.data} já é administrador da plataforma.\n`
          : `${email.data} agora é administrador da plataforma.\n`,
      );
      return;
    }

    const rawPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!rawPassword) {
      throw new UsageError("Usuário não encontrado. Para criá-lo, defina PLATFORM_ADMIN_PASSWORD (mínimo de 10 caracteres).");
    }
    const password = passwordField.safeParse(rawPassword);
    if (!password.success) {
      throw new UsageError(`PLATFORM_ADMIN_PASSWORD inválida: ${password.error.issues[0]?.message ?? "senha inválida."}`);
    }
    const name = nameField.safeParse(process.env.PLATFORM_ADMIN_NAME || "Administrador da plataforma");
    if (!name.success) throw new UsageError(`PLATFORM_ADMIN_NAME inválido: ${name.error.issues[0]?.message ?? "nome inválido."}`);

    try {
      await db.insert(users).values({
        email: email.data,
        name: name.data,
        passwordHash: await hashPassword(password.data),
        mustChangePassword: true,
        isPlatformAdmin: true,
      });
    } catch (error) {
      if (isUniqueViolation(error, "users_email_unique")) {
        throw new UsageError("O e-mail foi cadastrado por outro processo agora. Execute o comando novamente.");
      }
      throw error;
    }
    process.stdout.write(
      `Administrador da plataforma criado: ${email.data}. A troca de senha será exigida no primeiro acesso.\n`,
    );
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof Error && error.message.startsWith("Invalid or missing environment variable")) {
    // Safe by construction: names the variable, never its value (src/lib/env-schema.ts).
    process.stderr.write(`${error.message}. Configure .env.local (docs/onboarding.md).\n`);
  } else {
    const failure = error as { code?: string; cause?: { code?: string } };
    const code = failure?.cause?.code ?? failure?.code;
    process.stderr.write(`Falha ao configurar o administrador da plataforma${code ? ` (código ${code})` : ""}.\n`);
  }
  process.exitCode = 1;
});
