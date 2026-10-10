import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { ORIGIN, STATE_DIR } from "./env";

export const PASSWORD = "e2e-senha-1234";

let counter = 0;
/** Um email que mais nenhum teste usa: os testes partilham a mesma base de dados. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${counter++}@example.test`;
}

/** Cria a conta pela API (o cookie de sessão fica no contexto do browser) e abre «Meu espaço». */
export async function signUp(page: Page, email = uniqueEmail("ana")): Promise<string> {
  const res = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD }, headers: { Origin: ORIGIN } });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  return email;
}

/** Corre uma instrução SQL na base de dados de teste (a de `.e2e-state`): para o que a interface não faz, como promover um administrador. */
export function sql(command: string): void {
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", STATE_DIR, "--command", command], { stdio: "ignore" });
}

/** Cria a pasta pelo diálogo «Nova pasta». */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Nova pasta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova pasta" });
  await dialog.getByLabel("Nome da pasta").fill(name);
  await dialog.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

/** Envia um ficheiro pelo campo de ficheiros da página e espera que o envio acabe. */
export async function upload(page: Page, name: string, content: string | Buffer, mimeType = "text/plain"): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
  await expect(page.getByRole("button", { name: `Ações para o ficheiro ${name}` })).toBeVisible({ timeout: 10_000 });
}

/** Abre o menu «⋮» de uma linha e escolhe a ação. */
export async function chooseAction(page: Page, rowLabel: string, action: string): Promise<void> {
  await page.getByRole("button", { name: rowLabel }).click();
  await page.getByRole("menuitem", { name: action }).click();
}
