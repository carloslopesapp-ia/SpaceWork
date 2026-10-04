import type { ClientConfig } from "../../shared/types";
import { getConfig } from "../config";
import { createAuthedRouter } from "./authed";

export const clientConfig = createAuthedRouter();

/** Os limites que o browser precisa de conhecer (hoje só o tamanho máximo de um ficheiro). */
clientConfig.get("/", (c) =>
  c.json({ maxUploadBytes: getConfig(c.env).maxUploadBytes } satisfies ClientConfig),
);
