import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "senha-e2e-forte-1";

export function uniqueEmail(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Creates a company through the real sign-up form and lands on the dashboard. */
export async function signUpCompany(page: Page, company = `Empresa ${randomUUID().slice(0, 6)}`) {
  const email = uniqueEmail("dono");
  await page.goto("/criar-conta");
  await page.getByLabel("Nome da empresa").fill(company);
  await page.getByLabel("Seu nome").fill("Dona Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta da empresa" }).click();
  await expect(page).toHaveURL(/\/painel/);
  return { email, company };
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menu do perfil" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).or(page.getByRole("button", { name: "Sair" })).first().click();
  await expect(page).toHaveURL(/\/entrar/);
}
