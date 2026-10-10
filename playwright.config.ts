import { defineConfig } from "@playwright/test";
import { ORIGIN, PORT, STATE_DIR } from "./e2e/env";

// Os testes correm contra a aplicação CONSTRUÍDA (`vite build` + `vite preview`): é o Worker real no workerd, com os assets estáticos e o
// `public/_headers` aplicados como em produção. A base de dados e o R2 vivem em `.e2e-state` e começam vazios em cada execução.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // Os testes partilham um só servidor e uma só base de dados: correm um de cada vez e cada um usa emails que mais ninguém usa.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: ORIGIN,
    // `E2E_CHANNEL=chrome` usa o Google Chrome instalado em vez do Chromium do Playwright (`npx playwright install chromium`).
    channel: process.env.E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    // A construção vem antes das migrações: o wrangler segue o `.wrangler/deploy/config.json` até ao `dist/`, que a construção recria; com o
    // `dist/` apagado e o ficheiro de redirecionamento ainda lá, migrar primeiro falha.
    command: [
      `rm -rf ${STATE_DIR}`,
      "npm run build",
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE_DIR}`,
      `E2E_STATE=${STATE_DIR} npx vite preview --port ${PORT} --strictPort`,
    ].join(" && "),
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
