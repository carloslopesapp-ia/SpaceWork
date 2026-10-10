import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { chooseAction, signUp, upload } from "./support";

const NOT_AVAILABLE = "Este link não existe ou já não está disponível.";

test("partilhar: criar o link, copiá-lo, abri-lo sem sessão, descarregar como anexo e revogá-lo", async ({ page, browser, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let link = "";
  await signUp(page);
  await upload(page, "relatorio.txt", "conteúdo do relatório");

  await test.step("cria o link e copia-o para a área de transferência", async () => {
    await chooseAction(page, "Ações para o ficheiro relatorio.txt", "Partilhar…");
    const dialog = page.getByRole("dialog", { name: "Partilhar «relatorio.txt»" });
    await dialog.getByLabel("Validade do link").selectOption({ label: "7 dias" });
    await dialog.getByRole("button", { name: "Criar link" }).click();
    await dialog.getByRole("button", { name: "Copiar" }).click();
    await expect(dialog.getByText("Link copiado.")).toBeVisible();
    const shown = await dialog.getByLabel("Link de partilha").inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
    expect(shown).toMatch(/\/s\/[\w-]{20,}$/);
    link = shown;
  });

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();

  await test.step("quem não tem conta abre o link (o fallback de SPA do Worker) e descarrega", async () => {
    await guestPage.goto(link);
    await expect(guestPage.getByText("relatorio.txt")).toBeVisible();
    await expect(guestPage.getByText(/\d+ B$/)).toBeVisible();
    const download = guestPage.waitForEvent("download");
    await guestPage.getByRole("link", { name: "Descarregar" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("relatorio.txt");
    expect(await readFile(await file.path(), "utf8")).toBe("conteúdo do relatório");
  });

  await test.step("o descarregamento público é sempre um anexo, isolado", async () => {
    const href = (await guestPage.getByRole("link", { name: "Descarregar" }).getAttribute("href"))!;
    const res = await guestPage.request.get(href);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  await test.step("revogar o link faz com que deixe de funcionar logo", async () => {
    const dialog = page.getByRole("dialog", { name: "Partilhar «relatorio.txt»" });
    await dialog.getByRole("button", { name: /^Revogar o link 1/ }).click();
    await expect(dialog.getByText("Ainda não há links ativos.")).toBeVisible();
    await guestPage.reload();
    await expect(guestPage.getByText(NOT_AVAILABLE)).toBeVisible();
  });

  await guest.close();
});

test("um link que nunca existiu mostra o mesmo aviso que um revogado", async ({ page }) => {
  await page.goto("/s/um-token-que-nunca-existiu");
  await expect(page.getByText(NOT_AVAILABLE)).toBeVisible();
});

test("sem permissão para a área de transferência, «Copiar» seleciona o link e explica como o copiar à mão", async ({ page }) => {
  await signUp(page);
  await upload(page, "nota.txt", "olá");
  await chooseAction(page, "Ações para o ficheiro nota.txt", "Partilhar…");
  const dialog = page.getByRole("dialog", { name: "Partilhar «nota.txt»" });
  await dialog.getByRole("button", { name: "Criar link" }).click();

  await dialog.getByRole("button", { name: "Copiar" }).click();

  await expect(dialog.getByText(/Não foi possível copiar sozinho/)).toBeVisible();
  const field = dialog.getByLabel("Link de partilha");
  await expect(field).toBeFocused();
  expect(await field.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))).toBe(await field.inputValue());
});
