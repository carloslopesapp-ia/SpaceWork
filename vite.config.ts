import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // `E2E_STATE` (só nos testes de ponta a ponta) manda guardar a D1 e o R2 simulados noutra pasta, para não mexerem na `.wrangler` de desenvolvimento.
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      persistState: process.env.E2E_STATE ? { path: process.env.E2E_STATE } : true,
      // Nos testes de ponta a ponta o registo é aberto (cada teste cria a sua conta e entra logo); a produção usa o registo por aprovação.
      config: (userConfig) => (process.env.E2E_STATE ? { vars: { ...userConfig.vars, REGISTRATION_OPEN: "true" } } : undefined),
    }),
  ],
});
