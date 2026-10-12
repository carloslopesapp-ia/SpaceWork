import { expect, test } from "@playwright/test";
import { signUp, upload } from "./support";

// Um PNG de 1×1, válido.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

test("a pré-visualização passa de uma imagem à seguinte com as setas e com o teclado, e ao fechar o foco volta à que estava à vista", async ({ page }) => {
  await signUp(page);
  await upload(page, "a.png", PNG, "image/png");
  await upload(page, "nota.txt", "olá"); // o texto não se pré-visualiza: as setas saltam-no
  await upload(page, "b.png", PNG, "image/png");
  await upload(page, "c.png", PNG, "image/png");

  await page.getByRole("button", { name: "a.png", exact: true }).click();

  await test.step("no primeiro ficheiro a seta de trás está desativada, e o contador diz onde se está", async () => {
    const dialog = page.getByRole("dialog", { name: "a.png" });
    await expect(dialog.getByText("1 de 3")).toBeVisible(); // a.png, b.png e c.png: o texto não conta
    await expect(dialog.getByRole("button", { name: "Ficheiro anterior" })).toHaveAttribute("aria-disabled", "true");
  });

  await test.step("a seta da frente e a tecla → passam à seguinte, e a imagem carrega-se de verdade", async () => {
    await page.getByRole("button", { name: "Ficheiro seguinte" }).click();
    await expect(page.getByRole("dialog", { name: "b.png" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const dialog = page.getByRole("dialog", { name: "c.png" });
    await expect(dialog.getByText("3 de 3")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Ficheiro seguinte" })).toHaveAttribute("aria-disabled", "true");
    const image = dialog.getByRole("img", { name: "c.png" });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1);
  });

  await test.step("a tecla ← volta atrás, e o Esc fecha e devolve o foco à imagem que estava à vista", async () => {
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: "b.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "b.png", exact: true })).toBeFocused();
  });
});
