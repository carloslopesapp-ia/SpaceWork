import type { AdminUser, Role, UserStatus } from "../../shared/types";
import { isValidQuota, MAX_QUOTA_BYTES } from "../../shared/validation";
import { ApiError } from "../errors";
import { readJsonObject } from "../lib/http";
import { deleteUserSessionsStatement } from "../lib/sessions";
import { requireAdmin } from "../middleware/admin";
import { createAuthedRouter } from "./authed";

/**
 * As rotas do administrador: gerem contas e quotas e **nada mais**. Não há nenhuma rota para ver ou descarregar ficheiros de outros
 * utilizadores (um teste fixa a lista de rotas). Passam por `requireAuth` e depois por `requireAdmin`.
 */
export const admin = createAuthedRouter();
admin.use("*", requireAdmin);

interface UserRow {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  approved: number;
  quota_bytes: number;
  used_bytes: number;
  created_at: number;
}

const COLUMNS = "id, email, role, status, approved, quota_bytes, used_bytes, created_at";

/** A conta tal como o painel a vê: sem a senha nem qualquer outra coluna que não esteja aqui. */
function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    approved: row.approved === 1,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    createdAt: row.created_at,
  };
}

async function findUser(db: D1Database, id: string): Promise<UserRow> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?1`).bind(id).first<UserRow>();
  if (!row) throw new ApiError(404, "user_not_found", "Utilizador não encontrado.");
  return row;
}

const adminProtected = () =>
  new ApiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.");
const accountDeleting = () => new ApiError(409, "account_deleting", "Esta conta está a ser removida.");

/**
 * Todas as contas (sem paginação na v1), incluindo as que estão a ser removidas: primeiro as que aguardam aprovação, que são as que pedem
 * uma decisão, e depois as outras; em cada grupo, da mais antiga para a mais recente.
 */
admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM users ORDER BY approved, created_at, id`).all<UserRow>();
  return c.json({ users: results.map(toAdminUser) });
});

/**
 * Muda a quota (`quotaBytes`, em bytes), o estado (`status`: `active` ou `suspended`) e/ou aprova a conta (`approved: true`, que não se
 * desfaz: para parar uma conta, suspende-se). Uma quota abaixo do uso atual só
 * impede novos uploads. Suspender termina as sessões na mesma `batch` do `UPDATE`: o filtro `status = 'active'` da autenticação não chega,
 * porque ao reativar a conta as sessões antigas voltariam a valer. Uma conta de administrador não se suspende (a quota pode mudar-se) e
 * uma conta em remoção não se mexe.
 */
admin.patch("/users/:id", async (c) => {
  const db = c.env.DB;
  const target = await findUser(db, c.req.param("id"));
  const body = await readJsonObject(c);
  const hasQuota = "quotaBytes" in body;
  const hasStatus = "status" in body;
  const hasApproved = "approved" in body;
  if (!hasQuota && !hasStatus && !hasApproved) {
    throw new ApiError(400, "invalid_body", "Indique a quota, o estado e/ou a aprovação.");
  }
  if (hasQuota && !isValidQuota(body.quotaBytes)) {
    throw new ApiError(400, "invalid_quota", `A quota tem de ser um número inteiro de bytes entre 0 e ${MAX_QUOTA_BYTES}.`);
  }
  if (hasStatus && body.status !== "active" && body.status !== "suspended") {
    throw new ApiError(400, "invalid_status", "O estado só pode ser «active» ou «suspended».");
  }
  if (hasApproved && body.approved !== true) {
    throw new ApiError(400, "invalid_approved", "A aprovação só se pode dar: «approved» tem de ser true.");
  }
  if (target.status === "deleting") throw accountDeleting();
  if (hasStatus && target.role === "admin") throw adminProtected();

  const quota = hasQuota ? (body.quotaBytes as number) : null;
  const status = hasStatus ? (body.status as string) : null;
  const statements = [
    db
      .prepare(
        `UPDATE users SET quota_bytes = COALESCE(?1, quota_bytes), status = COALESCE(?2, status), approved = COALESCE(?3, approved)
         WHERE id = ?4 AND status != 'deleting'`,
      )
      .bind(quota, status, hasApproved ? 1 : null, target.id),
  ];
  if (status === "suspended") statements.push(deleteUserSessionsStatement(db, target.id));
  const [updated] = await db.batch(statements);
  if (updated.meta.changes !== 1) throw accountDeleting(); // passou a estar em remoção entre a leitura e a escrita
  return c.json({ user: toAdminUser(await findUser(db, target.id)) });
});

/**
 * Apaga uma conta, numa só `batch`. Uma conta **por aprovar** (rejeitar o pedido) não tem ficheiros nem sessões: apaga-se de vez e o email
 * fica livre. As outras ficam em `deleting`, com as sessões terminadas, e a remoção dos ficheiros e das linhas é do cron
 * (`removeDeletingAccounts`). Os dois `UPDATE`/`DELETE` filtram por `approved`, e por isso, se a conta for aprovada entre a leitura e a
 * escrita, segue o caminho normal em vez de desaparecer. Idempotente (apagar uma conta já em remoção responde 204 outra vez); o email
 * das contas em `deleting` continua ocupado até o cron acabar.
 */
admin.delete("/users/:id", async (c) => {
  const db = c.env.DB;
  const target = await findUser(db, c.req.param("id"));
  if (target.role === "admin") throw adminProtected();
  await db.batch([
    db.prepare("DELETE FROM users WHERE id = ?1 AND approved = 0 AND role != 'admin'").bind(target.id),
    db.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1 AND approved = 1 AND role != 'admin'").bind(target.id),
    deleteUserSessionsStatement(db, target.id),
  ]);
  return c.body(null, 204);
});
