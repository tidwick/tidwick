-- A firm is named by its client, so the copied name goes. SQLite cannot drop a UNIQUE column in place, so the table
-- is rebuilt; person rows keep pointing at the same firm ids, which the deferred foreign keys check at commit.
PRAGMA defer_foreign_keys = on;
CREATE TABLE firm_new (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE REFERENCES client (id)
) STRICT;
INSERT INTO firm_new (id, client_id) SELECT id, client_id FROM firm;
DROP TABLE firm;
ALTER TABLE firm_new RENAME TO firm;
