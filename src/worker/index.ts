import { app } from "./app";
import { scheduledMaintenance } from "./cron";

export default {
  fetch: app.fetch,
  // O cron por hora de `wrangler.jsonc`: `waitUntil` mantém a execução viva até a manutenção acabar.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(scheduledMaintenance(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
