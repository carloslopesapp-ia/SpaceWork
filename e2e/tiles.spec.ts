import { expect, test } from "@playwright/test";
import { createFolder, signUp, upload } from "./support";

// Um PNG de 1×1, válido: o mosaico mostra a própria imagem (é pequena).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

test("o mosaico: escolher a vista, ver a imagem, o ícone e a pasta, abrir a pré-visualização, e a escolha fica depois de recarregar", async ({ page }) => {
  await signUp(page);
  await createFolder(page, "Fotos");
  await upload(page, "ponto.png", PNG, "image/png");
  await upload(page, "nota.txt", "olá");
  await expect(page.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Mosaico" }).click();

  await test.step("a imagem pequena mostra-se de verdade, o texto mostra o ícone e a pasta é uma ligação", async () => {
    const image = page.getByRole("listitem").filter({ hasText: "ponto.png" }).locator("img");
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1);
    await expect(page.getByRole("listitem").filter({ hasText: "nota.txt" }).getByText("TXT", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir a pasta Fotos" })).toHaveAttribute("href", /\/pasta\//);
  });

  await test.step("o quadrado abre a pré-visualização e o Esc devolve o foco", async () => {
    await page.getByRole("button", { name: "Pré-visualizar ponto.png" }).click();
    await expect(page.getByRole("dialog", { name: "ponto.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await test.step("a escolha fica guardada neste browser", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Mosaico" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Pré-visualizar ponto.png" })).toBeVisible();
  });

  await test.step("«Lista» volta às linhas", async () => {
    await page.getByRole("button", { name: "Lista" }).click();
    await expect(page.getByRole("link", { name: "Fotos", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pré-visualizar ponto.png" })).toHaveCount(0);
  });
});
