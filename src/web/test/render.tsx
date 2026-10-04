import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import App from "../App";
import { createQueryClient } from "../query-client";

/** Cliente de consultas para testes: o de produção, mas sem repetições (os erros aparecem logo). */
export function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } });
  return client;
}

/** `wrapper` para `renderHook`. */
export function queryWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** A aplicação inteira numa rota (router em memória), para testes de páginas. */
export function renderApp(route = "/", client = testQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client };
}
