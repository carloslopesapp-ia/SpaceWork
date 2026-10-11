import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // A produção tem o registo por aprovação (`wrangler.jsonc`): os testes partem do registo aberto e escolhem o modo quando precisam.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, REGISTRATION_OPEN: "true" } },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
