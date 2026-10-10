import { app } from "./app";
import { scheduledMaintenance } from "./cron";

export default {
  fetch: app.fetch,
  // O cron por hora de `wrangler.jsonc`. Devolve a promessa da manutenção, em vez de a entregar ao `waitUntil`: se um passo falhou,
  // a promessa rejeita e a invocação acaba com exceção, que o painel da Cloudflare mostra (uma rejeição só dentro do `waitUntil`
  // pode não marcar a execução como falhada).
  async scheduled(controller, env) {
    await scheduledMaintenance(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
