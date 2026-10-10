import { expect, test } from "@playwright/test";
import { chooseAction, signUp, upload } from "./support";

// Um PNG de 1×1 e um PDF mínimo, mas válidos.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("a pré-visualização de uma imagem carrega-a, sob uma CSP que a isola, e o Esc devolve o foco ao menu", async ({ page }) => {
  await signUp(page);
  await upload(page, "ponto.png", PNG, "image/png");

  await chooseAction(page, "Ações para o ficheiro ponto.png", "Pré-visualizar");

  const dialog = page.getByRole("dialog", { name: "ponto.png" });
  const image = dialog.getByRole("img", { name: "ponto.png" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);

  const res = await page.request.get((await image.getAttribute("src"))!);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ações para o ficheiro ponto.png" })).toBeFocused();
});

test("a pré-visualização de um PDF vai numa <iframe>, sem CSP (o leitor do browser precisa dela) e com suporte de Range", async ({ page }) => {
  await signUp(page);
  await upload(page, "minimo.pdf", PDF, "application/pdf");

  await chooseAction(page, "Ações para o ficheiro minimo.pdf", "Pré-visualizar");

  const frame = page.getByRole("dialog", { name: "minimo.pdf" }).locator("iframe");
  await expect(frame).toBeVisible();
  const src = (await frame.getAttribute("src"))!;

  const whole = await page.request.get(src);
  expect(whole.headers()["content-type"]).toBe("application/pdf");
  expect(whole.headers()["content-security-policy"]).toBeUndefined();
  expect(whole.headers()["content-disposition"]).toMatch(/^inline/);

  const part = await page.request.get(src, { headers: { Range: "bytes=0-7" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toMatch(/^bytes 0-7\//);
  expect(await part.text()).toBe("%PDF-1.1");
});
