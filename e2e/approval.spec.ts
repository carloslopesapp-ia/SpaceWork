import { expect, test } from "@playwright/test";
import { PASSWORD, signUp, sql, uniqueEmail } from "./support";

// O servidor dos testes de ponta a ponta tem o registo aberto (cada teste cria a sua conta e entra logo). Para ver o registo por aprovação num
// browser real, a conta entra pelo registo aberto e passa-se a «por aprovar» pela base de teste: o que se vê depois (o login, o painel e o
// contador) é o que se vê em produção. O ecrã do próprio registo por aprovação tem os testes da interface.
test("uma conta por aprovar não entra, aparece no painel e, depois de aprovada, entra", async ({ browser }) => {
  const adminEmail = uniqueEmail("admin");
  const anaEmail = uniqueEmail("ana");
  const adminContext = await browser.newContext();
  const anaContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const ana = await anaContext.newPage();
  await signUp(admin, adminEmail);
  sql(`UPDATE users SET role = 'admin' WHERE email = '${adminEmail}'`);
  await signUp(ana, anaEmail);
  sql(`UPDATE users SET approved = 0 WHERE email = '${anaEmail}'`);

  await test.step("a conta por aprovar não entra: a sessão deixa de valer e o login explica porquê", async () => {
    await ana.reload();
    await expect(ana.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await ana.getByLabel("Email").fill(anaEmail);
    await ana.getByLabel("Senha").fill(PASSWORD);
    await ana.getByRole("button", { name: "Entrar" }).click();
    await expect(ana.getByText("A sua conta aguarda a aprovação do administrador.")).toBeVisible();
  });

  const anaRow = admin.getByRole("row", { name: new RegExp(anaEmail) });
  await test.step("o administrador vê o pedido: o contador, «Aguarda aprovação» e as duas decisões", async () => {
    await admin.reload();
    await admin.getByRole("link", { name: "Admin, 1 conta por aprovar" }).click();
    await expect(anaRow.getByText("Aguarda aprovação")).toBeVisible();
    await expect(anaRow.getByRole("button", { name: `Rejeitar o pedido de ${anaEmail}` })).toBeVisible();
  });

  await test.step("«Aprovar»: a linha passa a «Ativa», o contador desaparece e a conta entra", async () => {
    await anaRow.getByRole("button", { name: `Aprovar a conta ${anaEmail}` }).click();
    await expect(anaRow.getByText("Ativa")).toBeVisible();
    await expect(anaRow.getByRole("button", { name: `Ações para a conta ${anaEmail}` })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Admin", exact: true })).toBeVisible();

    await ana.getByRole("button", { name: "Entrar" }).click();
    await expect(ana.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });

  await adminContext.close();
  await anaContext.close();
});
