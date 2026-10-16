import { expect, test } from "@playwright/test";
import { PASSWORD, signIn, signOut, signUpCompany } from "./helpers";

test("company sign-up, sign-out and sign-in", async ({ page }) => {
  const { email, company } = await signUpCompany(page);
  await expect(page.getByText("Conta criada")).toBeVisible();
  await expect(page.getByText(company).first()).toBeVisible();
  await expect(page.getByText("Primeiros passos")).toBeVisible();

  await signOut(page);
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/painel/);
});

test("protected pages redirect to sign-in and wrong credentials show a generic error", async ({ page }) => {
  await page.goto("/lojas");
  await expect(page).toHaveURL(/\/entrar\?next=%2Flojas/);
  await signIn(page, "ninguem@example.test", "senha-errada-123");
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha inválidos.");
});

test("sign-up validates fields inline", async ({ page }) => {
  await page.goto("/criar-conta");
  await page.getByLabel("CNPJ").fill("11.111.111/1111-11");
  await page.getByLabel("Senha").fill("curta");
  await page.getByRole("button", { name: "Criar conta da empresa" }).click();
  await expect(page.getByText("CNPJ inválido.")).toBeVisible();
  await expect(page.getByText("A senha precisa ter ao menos 10 caracteres.")).toBeVisible();
  await expect(page.getByText("Informe o nome da empresa.")).toBeVisible();
});
