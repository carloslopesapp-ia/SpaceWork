/** A porta onde os testes de ponta a ponta servem a aplicação construída (fora das portas de desenvolvimento, 5173 e 5174). */
export const PORT = 4180;
export const ORIGIN = `http://localhost:${PORT}`;
/** A pasta onde esse servidor guarda a D1 e o R2 simulados: nunca é a `.wrangler` de desenvolvimento. */
export const STATE_DIR = ".e2e-state";
