import { env } from "cloudflare:workers";
import { app } from "../src/worker/app";

/** Chama a app diretamente com bindings/variáveis alterados (o resto vem de `env`). */
export async function fetchWithEnv(request: Request, override: Record<string, unknown>): Promise<Response> {
  return app.fetch(request, { ...env, ...override } as Env);
}

/**
 * `DB` em Proxy que corre `before` uma única vez, imediatamente antes de executar a primeira instrução
 * cujo SQL casa com `pattern` (também dentro de uma `batch`). Simula uma corrida: outro pedido mexe na
 * base depois de a app ler o estado e antes de ela escrever. `before` tem de usar o `env.DB` real, nunca
 * o proxy. Tudo o resto delega no `env.DB` real, com `this` ligado a ele (como em `dbWithBatchHook`).
 */
export function dbWithStatementHook(pattern: RegExp, before: () => Promise<void>): D1Database {
  const real = new WeakMap<object, { statement: D1PreparedStatement; sql: string }>();
  let fired = false;

  async function fireFor(sql: string): Promise<void> {
    if (fired || !pattern.test(sql)) return;
    fired = true;
    await before();
  }

  function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    const wrapped: D1PreparedStatement = new Proxy(statement, {
      get(target, prop) {
        switch (prop) {
          case "bind":
            return (...values: unknown[]) => wrap(target.bind(...values), sql);
          case "run":
            return async () => {
              await fireFor(sql);
              return target.run();
            };
          case "first":
            return async (column?: string) => {
              await fireFor(sql);
              return column === undefined ? target.first() : target.first(column);
            };
          case "all":
            return async () => {
              await fireFor(sql);
              return target.all();
            };
          case "raw":
            return async (options?: { columnNames?: boolean }) => {
              await fireFor(sql);
              return target.raw(options as never);
            };
          default: {
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        }
      },
    });
    real.set(wrapped, { statement, sql });
    return wrapped;
  }

  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const entries = statements.map((statement) => real.get(statement));
          for (const entry of entries) if (entry) await fireFor(entry.sql);
          return target.batch(statements.map((statement, i) => entries[i]?.statement ?? statement));
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
