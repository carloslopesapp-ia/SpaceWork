import { expect, test } from "@playwright/test";
import { chooseAction, createFolder, PASSWORD, uniqueEmail, upload } from "./support";

// O teste de fumo da especificação (secção 10): registo, login, criar pasta, carregar, mover, excluir e restaurar, tudo pela interface.
test("registo, pasta, envio, mover, excluir, restaurar e voltar a entrar", async ({ page }) => {
  const email = uniqueEmail("fumo");

  await test.step("sem sessão a aplicação pede o login, e regista-se uma conta", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await page.getByRole("link", { name: "Registe-se" }).click();
    // As páginas carregam-se por partes: sem esperar pelo título, o email iria para o formulário de login, que ainda está no ecrã.
    await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirmar senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  await test.step("cria uma pasta e envia um ficheiro", async () => {
    await createFolder(page, "Fotos");
    await upload(page, "nota.txt", "olá, mundo");
    await expect(page.getByText("Concluído")).toBeVisible();
  });

  await test.step("move o ficheiro para a pasta", async () => {
    await chooseAction(page, "Ações para o ficheiro nota.txt", "Mover…");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Pasta de destino").selectOption({ label: "Fotos" });
    await dialog.getByRole("button", { name: "Mover" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toHaveCount(0); // saiu da raiz
    await page.getByRole("link", { name: "Fotos" }).click();
    await expect(page.getByRole("heading", { name: "Fotos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toBeVisible();
  });

  await test.step("exclui o ficheiro (vai para a lixeira) e restaura-o", async () => {
    await chooseAction(page, "Ações para o ficheiro nota.txt", "Excluir");
    await page.getByRole("dialog", { name: "Excluir ficheiro" }).getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toHaveCount(0);

    await page.getByRole("link", { name: "Lixeira" }).click();
    const restore = page.getByRole("button", { name: "Restaurar nota.txt" });
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(restore).toHaveCount(0); // saiu da lixeira

    await page.getByRole("link", { name: "Meu espaço" }).click();
    await page.getByRole("link", { name: "Fotos" }).click();
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toBeVisible(); // voltou à pasta de origem
  });

  await test.step("sai e volta a entrar com a mesma conta", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });
});
