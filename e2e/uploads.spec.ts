import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signUp, sql, upload } from "./support";

test("o envio leva o Content-Length do ficheiro (o Worker exige-o) e o ficheiro desce igual, sempre como anexo", async ({ page }) => {
  await signUp(page);
  const content = "x".repeat(10_000);
  const sent = page.waitForRequest((request) => request.method() === "PUT" && request.url().includes("/api/files?"));

  await upload(page, "dez-mil.txt", content);

  expect((await (await sent).allHeaders())["content-length"]).toBe("10000");

  await page.getByRole("button", { name: "Ações para o ficheiro dez-mil.txt" }).click();
  const link = page.getByRole("menuitem", { name: "Descarregar" });
  const href = (await link.getAttribute("href"))!;
  const download = page.waitForEvent("download");
  await link.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("dez-mil.txt");
  expect(await readFile(await file.path(), "utf8")).toBe(content);

  const res = await page.request.get(href);
  expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
});

test("arrastar e largar um ficheiro sobre a página envia-o para a pasta atual", async ({ page }) => {
  await signUp(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["largado"], "largado.txt", { type: "text/plain" }));
    return transfer;
  });
  const heading = page.getByRole("heading", { name: "Meu espaço" });

  await heading.dispatchEvent("dragenter", { dataTransfer });
  await heading.dispatchEvent("drop", { dataTransfer });

  await expect(page.getByRole("button", { name: "Ações para o ficheiro largado.txt" })).toBeVisible();
});

test("um envio que não cabe na quota é recusado com a mensagem do servidor, e nada fica na lista", async ({ page }) => {
  const email = await signUp(page);
  sql(`UPDATE users SET quota_bytes = 5 WHERE email = '${email}'`);

  await page.locator('input[type="file"]').setInputFiles({ name: "grande.txt", mimeType: "text/plain", buffer: Buffer.from("mais de cinco bytes") });

  await expect(page.getByText("Sem espaço suficiente na sua quota.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ações para o ficheiro grande.txt" })).toHaveCount(0);
});
