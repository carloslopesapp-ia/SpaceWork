import type { PublicUser, UserStatus } from "../shared/types";

/** Utilizador autenticado, carregado da sessão em cada pedido. */
export interface AuthUser extends PublicUser {
  status: UserStatus;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
    sessionTokenHash: string;
  };
};
