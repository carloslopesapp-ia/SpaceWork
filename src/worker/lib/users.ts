import type { PublicUser, Role, UserStatus } from "../../shared/types";
import type { AuthUser } from "../types";

/** Colunas de `users` sem a senha, tal como vêm da D1. */
export interface UserRow {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  quota_bytes: number;
  used_bytes: number;
}

export function rowToAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
  };
}

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    quotaBytes: user.quotaBytes,
    usedBytes: user.usedBytes,
  };
}
