-- Índices das varreduras do cron de manutenção (src/worker/cron.ts). Os que já existiam começam por `user_id` ou por `email`: sem
-- estes, cada execução leria as tabelas inteiras. Os parciais só cobrem as linhas que a manutenção procura, por isso ocupam quase nada.

-- Envios `pending` mais velhos do que o corte.
CREATE INDEX files_pending_created ON files (created_at) WHERE status = 'pending';
-- Ficheiros na lixeira há mais do que a retenção, de todos os utilizadores (`files_trash` começa por `user_id`).
CREATE INDEX files_trash_expiry ON files (deleted_at) WHERE deleted_at IS NOT NULL;
-- Falhas de login com mais de um dia (`login_failures_email` começa pelo email).
CREATE INDEX login_failures_failed_at ON login_failures (failed_at);
-- Partilhas revogadas ou expiradas há mais de 30 dias.
CREATE INDEX shares_revoked_at ON shares (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX shares_expires_at ON shares (expires_at) WHERE expires_at IS NOT NULL;
-- Contas em remoção.
CREATE INDEX users_deleting ON users (created_at) WHERE status = 'deleting';
