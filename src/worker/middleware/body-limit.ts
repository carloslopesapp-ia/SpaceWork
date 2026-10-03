import { bodyLimit } from "hono/body-limit";

/** Limite para pedidos JSON da API: 64 KiB. O upload de ficheiros não usa este middleware. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

export const jsonBodyLimit = bodyLimit({
  maxSize: JSON_BODY_LIMIT_BYTES,
  onError: (c) =>
    c.json({ error: "payload_too_large", message: "O pedido é demasiado grande." }, 413),
});
