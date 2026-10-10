import { expect, test } from "@playwright/test";
import { chooseAction, createFolder, signUp, upload } from "./support";

test("um diálogo: a página não rola por baixo, o Esc fecha e o foco volta ao botão que o abriu", async ({ page }) => {
  await signUp(page);
  const open = page.getByRole("button", { name: "Nova pasta" });

  await open.click();
  await expect(page.getByRole("dialog", { name: "Nova pasta" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("o menu «⋮» abre com a seta para baixo, salta com Home e End, e o Esc devolve o foco ao botão", async ({ page }) => {
  await signUp(page);
  await upload(page, "nota.txt", "olá");
  const button = page.getByRole("button", { name: "Ações para o ficheiro nota.txt" });

  await button.focus();
  await page.keyboard.press("ArrowDown");
  const items = page.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText("Excluir");
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("a confirmação de «Excluir» descreve a pergunta, e depois de excluir o foco vai para o conteúdo (o botão da linha desapareceu)", async ({ page }) => {
  await signUp(page);
  await upload(page, "nota.txt", "olá");

  await chooseAction(page, "Ações para o ficheiro nota.txt", "Excluir");

  const dialog = page.getByRole("dialog", { name: "Excluir ficheiro" });
  await expect(dialog).toHaveAccessibleDescription("Excluir o ficheiro «nota.txt»? Vai para a lixeira.");
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused(); // a ação segura
  await dialog.getByRole("button", { name: "Excluir" }).click();

  await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
});

test("«Sair» com um envio a decorrer pergunta antes: «Cancelar» mantém a sessão, «Sair» termina-a", async ({ page }) => {
  await signUp(page);
  // O envio fica a meio: o pedido nunca recebe resposta.
  await page.route("**/api/files?*", () => new Promise(() => undefined));
  await page.locator('input[type="file"]').setInputFiles({ name: "grande.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(1024 * 1024) });
  await expect(page.getByRole("button", { name: "Cancelar o envio de grande.bin" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  const dialog = page.getByRole("dialog", { name: "Sair com envios em curso" });
  await expect(dialog).toHaveAccessibleDescription(/Há envios por terminar/);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await page.getByRole("dialog", { name: "Sair com envios em curso" }).getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("um ficheiro largado sobre um diálogo aberto não é enviado", async ({ page }) => {
  await signUp(page);
  // Conta os envios (`PUT /api/files?...`) desde já: uma negativa logo a seguir ao largar podia passar antes de o envio começar.
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/files?")) uploads++;
  });
  await page.getByRole("button", { name: "Nova pasta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova pasta" });
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["largado"], "largado.txt", { type: "text/plain" }));
    return transfer;
  });

  await dialog.dispatchEvent("dragenter", { dataTransfer });
  await dialog.dispatchEvent("drop", { dataTransfer });
  await dialog.getByRole("button", { name: "Cancelar" }).click(); // no diálogo: «Cancelar o envio de…» também casaria, se o envio começasse

  // Uma ida completa ao servidor dá tempo a uma guarda avariada de começar o envio; só depois se verifica que não houve nenhum.
  await createFolder(page, "Fotos"); // a aplicação continua a responder
  expect(uploads).toBe(0);
  await expect(page.getByRole("button", { name: "Ações para o ficheiro largado.txt" })).toHaveCount(0);
});
