import { expect, test } from "@playwright/test";
import { ORIGIN } from "./env";
import { PASSWORD, signUp, sql, uniqueEmail, upload } from "./support";

test("o painel do administrador: quota, suspender, reativar e apagar contas, e a manutenção que as remove", async ({ browser, request }) => {
  const adminEmail = uniqueEmail("admin");
  const anaEmail = uniqueEmail("ana");
  const adminContext = await browser.newContext();
  const anaContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const ana = await anaContext.newPage();
  await signUp(admin, adminEmail);
  sql(`UPDATE users SET role = 'admin' WHERE email = '${adminEmail}'`);
  await signUp(ana, anaEmail);

  const anaRow = admin.getByRole("row", { name: new RegExp(anaEmail) });
  const anaMenu = admin.getByRole("button", { name: `Ações para a conta ${anaEmail}` });
  const choose = async (action: string) => {
    await anaMenu.click();
    await admin.getByRole("menuitem", { name: action }).click();
  };

  await test.step("só o administrador vê «Admin»; a quem não é, o endereço leva a «Meu espaço»", async () => {
    await admin.reload();
    await admin.getByRole("link", { name: "Admin" }).click();
    await expect(admin.getByRole("heading", { name: "Utilizadores" })).toBeVisible();
    await expect(anaRow).toBeVisible();
    await expect(ana.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await ana.goto("/admin");
    await expect(ana.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });

  await test.step("uma quota a 0 impede os envios da conta", async () => {
    await choose("Alterar quota…");
    const dialog = admin.getByRole("dialog", { name: `Quota de ${anaEmail}` });
    await dialog.getByLabel("Quota (GB)").fill("0");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await expect(anaRow.getByText(/de 0 B/)).toBeVisible();

    await ana.locator('input[type="file"]').setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(ana.getByText("Sem espaço suficiente na sua quota.")).toBeVisible();
  });

  await test.step("suspender: a sessão da conta cai e o login diz porquê", async () => {
    await choose("Suspender…");
    await admin.getByRole("dialog", { name: "Suspender conta" }).getByRole("button", { name: "Suspender" }).click();
    await expect(anaRow.getByText("Suspensa")).toBeVisible();

    await ana.reload();
    await expect(ana.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await ana.getByLabel("Email").fill(anaEmail);
    await ana.getByLabel("Senha").fill(PASSWORD);
    await ana.getByRole("button", { name: "Entrar" }).click();
    await expect(ana.getByText("Conta suspensa. Contacte o administrador.")).toBeVisible();
  });

  await test.step("reativar: a conta volta a entrar", async () => {
    await choose("Reativar");
    await expect(anaRow.getByText("Ativa")).toBeVisible();
    await ana.getByRole("button", { name: "Entrar" }).click();
    await expect(ana.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });

  await test.step("apagar: a conta fica «A remover», sem menu, e o email continua ocupado", async () => {
    await choose("Apagar conta…");
    await admin.getByRole("dialog", { name: "Apagar conta" }).getByRole("button", { name: "Apagar conta" }).click();
    await expect(anaRow.getByText("A remover")).toBeVisible();
    await expect(anaMenu).toHaveCount(0);

    await ana.reload();
    await expect(ana.getByRole("heading", { name: "Entrar" })).toBeVisible(); // a sessão acabou

    const taken = await request.post("/api/auth/register", { data: { email: anaEmail, password: PASSWORD }, headers: { Origin: ORIGIN } });
    expect(taken.status()).toBe(409);
  });

  await test.step("a manutenção (o gatilho do cron) remove a conta e liberta o email", async () => {
    const cron = await request.get("/cdn-cgi/handler/scheduled?cron=0+*+*+*+*");
    expect(cron.status()).toBe(200);
    await admin.getByRole("button", { name: "Atualizar" }).click();
    await expect(anaRow).toHaveCount(0);

    const again = await request.post("/api/auth/register", { data: { email: anaEmail, password: PASSWORD }, headers: { Origin: ORIGIN } });
    expect(again.status()).toBe(201);
  });

  await adminContext.close();
  await anaContext.close();
});

test("o administrador não vê os ficheiros de outras contas (nem na lista, nem na pesquisa)", async ({ browser, request }) => {
  const adminEmail = uniqueEmail("admin");
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signUp(admin, adminEmail);
  sql(`UPDATE users SET role = 'admin' WHERE email = '${adminEmail}'`);
  const anaContext = await browser.newContext();
  const ana = await anaContext.newPage();
  await signUp(ana);
  await upload(ana, "segredo.txt", "só da ana");

  await admin.goto("/");
  await expect(admin.getByRole("button", { name: "Ações para o ficheiro segredo.txt" })).toHaveCount(0);
  await expect(admin.getByText("segredo.txt")).toHaveCount(0);
  // Nem há rota para o admin ir buscar o ficheiro de outra conta.
  const search = await admin.request.get("/api/search?q=segredo");
  expect(await search.json()).toEqual({ results: [] });
  expect((await request.get("/api/admin/users")).status()).toBe(401); // sem sessão

  await adminContext.close();
  await anaContext.close();
});
