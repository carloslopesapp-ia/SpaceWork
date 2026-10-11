import { rmSync } from "node:fs";

/**
 * A construção dos testes de ponta a ponta tem o registo aberto (a de produção é por aprovação): não pode ficar em `dist/` à espera de um
 * `wrangler deploy` à mão, que a publicava. Sem `dist/` (e sem o ficheiro de redirecionamento do plugin), esse comando falha à vista.
 */
export default function globalTeardown() {
  rmSync("dist", { recursive: true, force: true });
  rmSync(".wrangler/deploy", { recursive: true, force: true });
}
