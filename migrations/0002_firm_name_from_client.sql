-- A firm is named by its client, so the copied name goes. SQLite cannot drop a UNIQUE column in place, so the table
-- is rebuilt through a keep table: the rows go back into a table named firm, which settles the deferred foreign
-- keys that person rows hold (renaming a new table into place leaves the check failing at commit).
PRAGMA defer_foreign_keys = on;
CREATE TABLE firm_keep AS SELECT id, client_id FROM firm;
DROP TABLE firm;
CREATE TABLE firm (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE REFERENCES client (id)
) STRICT;
INSERT INTO firm (id, client_id) SELECT id, client_id FROM firm_keep;
DROP TABLE firm_keep;
