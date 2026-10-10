import { expect, test, type Page } from "@playwright/test";
import { chooseAction, createFolder, signUp, upload } from "./support";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** As violações da CSP que o browser vê na página (o evento `securitypolicyviolation`), mesmo através de navegações completas. */
async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction("reportViolation", (text: string) => seen.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { reportViolation: (text: string) => void }).reportViolation(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return seen;
}

test("as páginas levam a CSP, e a API não (as respostas de ficheiros têm a sua)", async ({ request }) => {
  const index = await request.get("/");
  const csp = index.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(index.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(index.headers()["referrer-policy"]).toBe("same-origin");

  const health = await request.get("/api/health");
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect(health.headers()["content-security-policy"]).toBeUndefined();
});

test("a aplicação inteira corre sem uma única violação da CSP (login, pastas, diálogos, pré-visualização, lixeira, conta e página pública)", async ({ page, browser }) => {
  const violations = await watchViolations(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await signUp(page);
  await createFolder(page, "Fotos"); // diálogo
  await upload(page, "ponto.png", PNG, "image/png"); // a barra de progresso usa `style`
  await chooseAction(page, "Ações para o ficheiro ponto.png", "Pré-visualizar"); // <img> da própria origem
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");

  await chooseAction(page, "Ações para o ficheiro ponto.png", "Partilhar…");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Criar link" }).click();
  const link = await dialog.getByLabel("Link de partilha").inputValue();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Lixeira" }).click();
  await expect(page.getByRole("heading", { name: "Lixeira" })).toBeVisible();
  await page.getByRole("link", { name: "Conta" }).click();
  await expect(page).toHaveURL(/\/conta$/);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestViolations = await watchViolations(guestPage);
  await guestPage.goto(link);
  await expect(guestPage.getByRole("link", { name: "Descarregar" })).toBeVisible();

  expect(violations).toEqual([]);
  expect(guestViolations).toEqual([]);
  await guest.close();
});

test("a CSP está mesmo em vigor: um script inserido na página não corre, e o browser regista a violação", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injetado = true";
    document.head.append(script);
  });

  expect(await page.evaluate(() => (window as unknown as { __injetado?: boolean }).__injetado)).toBeUndefined();
  await expect.poll(() => violations).toEqual([expect.stringMatching(/^script-src/)]);
});
