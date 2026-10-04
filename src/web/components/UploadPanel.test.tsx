import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UploadsProvider, useUploads } from "../uploads-context";
import { stubXhr } from "../test/fake-xhr";
import { apiError, json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { UploadPanel } from "./UploadPanel";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 10, mime: "text/plain", createdAt: 1 };

function Adder({ names }: { names: string[] }) {
  const { add } = useUploads();
  return <button onClick={() => add(names.map((name) => new File(["x".repeat(10)], name)), null)}>Adicionar</button>;
}

function setup(names: string[]) {
  const Xhr = stubXhr();
  mockApi({ "GET /api/config": () => json({ maxUploadBytes: 1000 }), "GET /api/auth/me": () => apiError(401, "unauthorized", "x") });
  const Query = queryWrapper(testQueryClient());
  render(
    <Query>
      <UploadsProvider>
        <Adder names={names} />
        <UploadPanel />
      </UploadsProvider>
    </Query>,
  );
  return { Xhr, user: userEvent.setup() };
}

describe("UploadPanel", () => {
  it("não aparece quando não há envios", () => {
    setup([]);
    expect(screen.queryByRole("region", { name: "Envios" })).not.toBeInTheDocument();
  });

  it("mostra o progresso de um envio e depois «Concluído»", async () => {
    const { Xhr, user } = setup(["a.txt"]);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    const panel = screen.getByRole("region", { name: "Envios" });
    expect(within(panel).getByText("A enviar 1 ficheiro…")).toBeInTheDocument();

    act(() => Xhr.instances[0].progress(5, 10));
    expect(within(panel).getByRole("progressbar", { name: "Envio de a.txt" })).toHaveAttribute("aria-valuenow", "50");

    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    expect(await within(panel).findByText("Concluído")).toBeInTheDocument();
    expect(within(panel).getByText("Envios terminados")).toBeInTheDocument();
  });

  it("os ficheiros a mais ficam «Em espera» e dá para cancelar", async () => {
    const { Xhr, user } = setup(["a", "b", "c", "d"]);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(Xhr.instances).toHaveLength(3);
    expect(screen.getByText("Em espera")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar o envio de d" }));
    expect(screen.queryByText("Em espera")).not.toBeInTheDocument();
    expect(screen.getByText("A enviar 3 ficheiros…")).toBeInTheDocument();
  });

  it("mostra o erro de um envio e «Limpar» tira os terminados", async () => {
    const { Xhr, user } = setup(["a.txt"]);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    act(() =>
      Xhr.instances[0].respond(409, { error: "name_taken", message: "Já existe um ficheiro com esse nome neste local." }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um ficheiro com esse nome neste local.");
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    expect(screen.queryByRole("region", { name: "Envios" })).not.toBeInTheDocument();
  });
});
