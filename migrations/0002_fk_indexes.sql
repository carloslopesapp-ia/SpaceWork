-- Índices nas chaves estrangeiras que não tinham um índice a começar pela própria coluna: sem eles,
-- apagar um utilizador (`shares.user_id`) ou uma pasta (`files.folder_id`, `folders.parent_id`) varre as tabelas filhas inteiras.
CREATE INDEX files_folder_id ON files (folder_id);
CREATE INDEX folders_parent_id ON folders (parent_id);
CREATE INDEX shares_user_id ON shares (user_id);
