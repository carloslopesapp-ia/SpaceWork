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

/** O utilizador como o frontend o recebe ao entrar e em `/me`; para um administrador, com o número de contas por aprovar. */
export async function toSessionUser(db: D1Database, user: AuthUser): Promise<PublicUser> {
  const publicUser = toPublicUser(user);
  if (user.role !== "admin") return publicUser;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE approved = 0 AND status != 'deleting'").first<{ n: number }>();
  return { ...publicUser, pendingApprovals: row?.n ?? 0 };
}
