import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Testes da interface: correm em jsdom (os do Worker correm no workerd, ver vitest.config.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/web/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/web/test/setup.ts"],
  },
});
