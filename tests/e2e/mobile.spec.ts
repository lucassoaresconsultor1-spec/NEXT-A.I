import { expect, test } from "@playwright/test";
import { signUpCompany } from "./helpers";

test("navigation works on a phone-sized screen", async ({ page }) => {
  await signUpCompany(page);
  const menu = page.getByRole("button", { name: "Abrir menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("dialog").getByRole("link", { name: "Regiões" }).click();
  await expect(page).toHaveURL(/\/regioes/);
  await expect(page.getByRole("heading", { name: "Regiões" })).toBeVisible();
  // No horizontal page scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
