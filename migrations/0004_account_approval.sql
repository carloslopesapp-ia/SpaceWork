-- Registo por aprovação (REGISTRATION_OPEN = approval): 0 = a conta aguarda que um administrador a aprove; 1 = aprovada.
-- As contas que já existem ficam aprovadas (DEFAULT 1). É uma coluna nova, e não um estado novo, porque a restrição do `status`
-- não se altera sem recriar a tabela `users`, e na D1 isso arrisca apagar em cascata as sessões, as pastas e os ficheiros.
ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0, 1));
