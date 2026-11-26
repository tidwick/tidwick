// State that tests set or read directly, because the database is shared by every test in a file. Production code
// never imports this module.

const FIND = {
  client: 'SELECT id FROM client WHERE name = ?1',
  project: 'SELECT id FROM project WHERE client_id = ?1',
  task_code: 'SELECT id FROM task_code WHERE code = ?1',
  person: 'SELECT id FROM person WHERE email = ?1',
} as const;

const SOLE_ADMIN = `UPDATE person SET offboarded_at = 1
WHERE offboarded_at IS NULL AND id <> ?1 AND id IN (SELECT person_id FROM person_role WHERE role = 'admin')`;

const KEYS_OF_CLIENT = `SELECT c.name, (SELECT count(*) FROM client_key k WHERE k.client_id = c.id) AS keys
FROM client c WHERE c.id = ?1`;

/** The id of the one row a test just made, found by its natural key. */
export async function idOf(db: D1Database, kind: keyof typeof FIND, key: string): Promise<string> {
  const row = await db.prepare(FIND[kind]).bind(key).first<{ id: string }>();
  if (!row) throw new Error(`no ${kind} for ${key}`);
  return row.id;
}

/** Offboards every active admin but `keepId` by plain SQL, so that person is the only one left. */
export async function offboardOtherAdmins(db: D1Database, keepId: string): Promise<void> {
  await db.prepare(SOLE_ADMIN).bind(keepId).run();
}

/** Revokes one passkey row, to stage a state. */
export async function revokePasskey(db: D1Database, credentialId: string): Promise<void> {
  await db.prepare('UPDATE credential SET revoked_at = 1 WHERE id = ?1').bind(credentialId).run();
}

/** Stamps a person offboarded with no revocations, to stage a state. */
export async function stampOffboarded(db: D1Database, personId: string): Promise<void> {
  await db.prepare('UPDATE person SET offboarded_at = 1 WHERE id = ?1').bind(personId).run();
}

export async function offboardedAt(db: D1Database, personId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT offboarded_at FROM person WHERE id = ?1')
    .bind(personId)
    .first<{ offboarded_at: number | null }>();
  return row?.offboarded_at ?? null;
}

export async function clientWithKeyCount(
  db: D1Database,
  clientId: string,
): Promise<{ name: string; keys: number } | null> {
  return db.prepare(KEYS_OF_CLIENT).bind(clientId).first<{ name: string; keys: number }>();
}

/** The same database, counting every statement sent to it: one per execution, and one per statement in a batch. */
export function countingDb(db: D1Database): { db: D1Database; count: () => number } {
  let sent = 0;
  const originals = new WeakMap<object, D1PreparedStatement>();
  const EXECUTES = new Set<string | symbol>(['run', 'first', 'all', 'raw']);
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(statement, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (key === 'bind') {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        if (EXECUTES.has(key) && typeof value === 'function') {
          return (...args: unknown[]) => {
            sent += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  const counted: D1Database = new Proxy(db, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (key === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          sent += statements.length;
          return target.batch(statements.map((s) => originals.get(s) ?? s));
        };
      }
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { db: counted, count: () => sent };
}

/** A database whose first `times` batches each run `race` just before they are sent: a concurrent writer. */
export function racingDb(db: D1Database, race: () => Promise<unknown>, times: number): D1Database {
  let left = times;
  return new Proxy(db, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (left > 0) {
            left -= 1;
            await race();
          }
          return target.batch(statements);
        };
      }
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * A database whose first `times` executions of a statement containing `fragment` each run `race` just before
 * they read: a concurrent writer landing between two reads of one write, such as its before and its head.
 */
export function racingRead(
  db: D1Database,
  fragment: string,
  race: () => Promise<unknown>,
  times: number,
): D1Database {
  let left = times;
  const READS = new Set<string | symbol>(['first', 'all', 'raw', 'run']);
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (READS.has(key) && typeof value === 'function') {
          return async (...args: unknown[]) => {
            if (left > 0) {
              left -= 1;
              await race();
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string) =>
          sql.includes(fragment) ? wrap(target.prepare(sql)) : target.prepare(sql);
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** A database whose statements containing `fragment` throw `message` when prepared, as a D1 limit or outage would. */
export function failingDb(db: D1Database, fragment: string, message: string): D1Database {
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string) => {
          if (sql.includes(fragment)) throw new Error(message);
          return target.prepare(sql);
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** Inserts `count` live projects under a client in one batch, for tests that need more than a cap. */
export async function seedProjects(
  db: D1Database,
  clientId: string,
  count: number,
  at: number,
): Promise<void> {
  const rows: D1PreparedStatement[] = [];
  for (let n = 0; n < count; n++) {
    const id = crypto.randomUUID();
    rows.push(
      db
        .prepare('INSERT INTO project (id, client_id, name, created_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(id, clientId, `Seed ${id}`, at),
    );
  }
  await db.batch(rows);
}
