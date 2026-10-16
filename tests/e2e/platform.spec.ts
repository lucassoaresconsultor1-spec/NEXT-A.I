import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { changeTemporaryPassword, signIn, uniqueEmail } from "./helpers";

test("platform admin registers a company and its owner signs in with the temporary password", async ({ page }) => {
  const adminEmail = uniqueEmail("plataforma");
  const adminTemporary = "senha-admin-provisoria";
  // The real bootstrap command, against the E2E database.
  execFileSync("pnpm", ["-s", "platform:admin", adminEmail], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, PLATFORM_ADMIN_PASSWORD: adminTemporary },
    stdio: "pipe",
  });

  await signIn(page, adminEmail, adminTemporary);
  await changeTemporaryPassword(page, adminTemporary);
  await page.goto("/plataforma");
  await page.getByRole("link", { name: "Nova empresa" }).click();

  const company = `Loja Cliente ${randomUUID().slice(0, 6)}`;
  const ownerEmail = uniqueEmail("dono-cliente");
  const ownerTemporary = "senha-dono-provisoria";
  await page.getByLabel("Nome da empresa").fill(company);
  await page.getByLabel("Plano").selectOption("profissional");
  await page.getByLabel("Nome do dono").fill("Dono Cliente");
  await page.getByLabel("E-mail").fill(ownerEmail);
  await page.getByLabel("Senha provisória").fill(ownerTemporary);
  await page.getByRole("button", { name: "Cadastrar empresa" }).click();
  await expect(page.getByText("Empresa cadastrada.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(company) })).toContainText("Profissional");

  await page.goto("/plataforma/nova-empresa");
  await page.getByLabel("Nome da empresa").fill(`${company} 2`);
  await page.getByLabel("Nome do dono").fill("Outro Dono");
  await page.getByLabel("E-mail").fill(ownerEmail);
  await page.getByLabel("Senha provisória").fill(ownerTemporary);
  await page.getByRole("button", { name: "Cadastrar empresa" }).click();
  await expect(page.getByText("E-mail já cadastrado.")).toBeVisible();
  // Values survive the failed attempt.
  await expect(page.getByLabel("Nome da empresa")).toHaveValue(`${company} 2`);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await signIn(page, ownerEmail, ownerTemporary);
  await changeTemporaryPassword(page, ownerTemporary);
  await expect(page).toHaveURL(/\/painel/);
  await expect(page.getByText(`${company} · Dono`)).toBeVisible();
});
