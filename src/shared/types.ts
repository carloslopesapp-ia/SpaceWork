export type Role = "admin" | "user";
export type UserStatus = "active" | "suspended" | "deleting";

/** Utilizador tal como a API o devolve ao frontend. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  quotaBytes: number;
  usedBytes: number;
}
