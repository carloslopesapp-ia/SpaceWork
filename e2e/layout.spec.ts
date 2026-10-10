import { expect, test, type Page } from "@playwright/test";
import { createFolder, signUp, sql, uniqueEmail, upload } from "./support";

// 375 px: o ecrã de um telemóvel pequeno.
test.use({ viewport: { width: 375, height: 812 } });

/** Quantos píxeis a página excede a largura da janela (> 0 = rola na horizontal). */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("no telemóvel, um nome de pasta enorme e sem espaços não faz a página rolar na horizontal (o caminho parte-se)", async ({ page }) => {
  await signUp(page);
  const name = "P".repeat(90);
  await createFolder(page, name);

  await page.getByRole("link", { name }).click();

  await expect(page.getByRole("heading", { name })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("no telemóvel, um nome de ficheiro enorme e sem espaços não faz a lista rolar na horizontal", async ({ page }) => {
  await signUp(page);
  await upload(page, `${"f".repeat(90)}.txt`, "olá");

  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("no telemóvel, a tabela de contas rola dentro do seu contentor e não a página", async ({ page }) => {
  const email = await signUp(page, uniqueEmail("admin-comprido-".concat("x".repeat(40))));
  sql(`UPDATE users SET role = 'admin' WHERE email = '${email}'`);

  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Utilizadores" })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
