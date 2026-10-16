import { expect, test } from "@playwright/test";
import { PASSWORD, signIn, signOut, signUpCompany, uniqueEmail } from "./helpers";

test("owner creates a store, hits the plan limit and adds a salesperson with restricted access", async ({ page, browser }) => {
  await signUpCompany(page);

  // Store creation through the real form.
  await page.goto("/lojas/nova");
  await page.getByLabel("Código").fill("lj01");
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Loja Centro");
  await page.getByLabel("CNPJ").fill("12.ABC.345/01DE-35");
  await page.getByLabel("Telefone").fill("(22) 99876-5432");
  await page.getByLabel("CEP").fill("28970-000");
  await page.getByLabel("Cidade").fill("Araruama");
  await page.getByLabel("UF").selectOption("RJ");
  await page.getByRole("button", { name: "Cadastrar loja" }).click();
  await expect(page).toHaveURL(/\/lojas\/[0-9a-f-]{36}\?criada=1/);
  const storeUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: /Loja Centro/ })).toBeVisible();
  await expect(page.getByText("12.ABC.345/01DE-35")).toBeVisible();
  await expect(page.getByText("(22) 99876-5432")).toBeVisible();

  // Essencial allows one active store: the second one is refused by the server.
  await page.goto("/lojas/nova");
  await page.getByLabel("Código").fill("LJ02");
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Loja Praia");
  await page.getByRole("button", { name: "Cadastrar loja" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "plano" }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Nome", exact: true })).toHaveValue("Loja Praia");

  // Salesperson limited to the store.
  const sellerEmail = uniqueEmail("vendedor");
  await page.goto("/equipe/novo");
  await page.getByRole("textbox", { name: "Nome", exact: true }).fill("Vendedor Teste");
  await page.getByLabel("E-mail").fill(sellerEmail);
  await page.getByRole("combobox", { name: "Perfil" }).selectOption({ label: "Vendedor" });
  await page.getByRole("checkbox", { name: /Loja Centro/ }).check();
  await page.getByLabel("Senha provisória").fill("provisoria-123");
  await page.getByRole("button", { name: "Adicionar membro" }).click();
  await expect(page).toHaveURL(/\/equipe\/[0-9a-f-]{36}\?adicionado=novo/);
  await expect(page.getByText("Vendedor Teste").first()).toBeVisible();

  await page.goto("/auditoria");
  await expect(page.getByText("Membro adicionado").first()).toBeVisible();
  await expect(page.getByText("Loja criada").first()).toBeVisible();
  await signOut(page);

  // First access forces a password change; then the salesperson sees no team or structure management.
  await signIn(page, sellerEmail, "provisoria-123");
  await expect(page).toHaveURL(/\/alterar-senha/);
  await page.getByLabel("Senha atual").fill("provisoria-123");
  await page.getByLabel(/^Nova senha/).fill(PASSWORD);
  await page.getByLabel("Confirme a nova senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page).toHaveURL(/\/painel/);
  const nav = page.getByRole("navigation", { name: "Módulos" });
  await expect(nav.getByRole("link", { name: "Lojas" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Equipe" })).toHaveCount(0);
  await page.goto("/equipe");
  await expect(page.getByText("Acesso não permitido")).toBeVisible();
  await page.goto("/configuracoes");
  await expect(page.getByText("Acesso não permitido")).toBeVisible();
  await page.goto(storeUrl);
  await expect(page.getByRole("heading", { name: /Loja Centro/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);

  // Another company cannot open the store by URL.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUpCompany(otherPage);
  // Streamed pages keep HTTP 200 when notFound() runs after the shell (Next.js adds noindex);
  // what matters is that nothing of the other company's store is rendered.
  await otherPage.goto(storeUrl);
  await expect(otherPage.getByText("Página não encontrada")).toBeVisible();
  await expect(otherPage.getByText("Loja Centro")).toHaveCount(0);
  await expect(otherPage.getByText("12.ABC.345/01DE-35")).toHaveCount(0);
  await other.close();
});

test("platform pages are hidden from regular users", async ({ page }) => {
  await signUpCompany(page);
  const response = await page.goto("/plataforma");
  expect(response?.status()).toBe(404);
});
