import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { IDLE_MS, readSession, SESSION_COOKIE } from '../../src/auth/session';
import { storedRows } from '../../src/db/stored-rows';
import {
  DUMMY_MARKER,
  dummySecrets,
  dummyVars,
  LOCAL_SESSION_COOKIE,
  LOCAL_SESSION_MS,
  localEmail,
  localSession,
} from './local-dev';

const NOW = Date.UTC(2031, 2, 3, 9);
const SECRET = 'local-dev-test-secret';

async function person(id: string, email: string, offboardedAt: number | null): Promise<void> {
  await env.DB.exec(
    [
      "INSERT OR IGNORE INTO client (id, name, created_at) VALUES ('lc', 'Local', 1);",
      "INSERT OR IGNORE INTO firm (id, client_id) VALUES ('lf', 'lc');",
      `INSERT INTO person (id, firm_id, email, name, created_at, offboarded_at) VALUES ('${id}', 'lf', '${email}', 'Local person', 1, ${String(offboardedAt ?? 'NULL')});`,
    ].join('\n'),
  );
}

async function sessionsOf(personId: string): Promise<number> {
  return (await storedRows(env.DB, 'session')).filter((row) => row.person_id === personId).length;
}

describe('local dev session', () => {
  it('the cookie is the one the session middleware reads, inside the idle window', () => {
    expect(LOCAL_SESSION_COOKIE).toBe(SESSION_COOKIE);
    expect(LOCAL_SESSION_MS).toBeLessThanOrEqual(IDLE_MS);
  });

  it('a local session row reads back as a live session for that person', async () => {
    await person('lp1', 'grid-phone@practice.example', null);
    const { sql, cookie } = await localSession('grid-phone@practice.example', SECRET, NOW);
    await env.DB.exec(sql);
    expect(await sessionsOf('lp1')).toBe(1);
    const rawId = cookie.slice(`${LOCAL_SESSION_COOKIE}=`.length);
    expect((await readSession(env.DB, SECRET, rawId, NOW + 1))?.personId).toBe('lp1');
    expect(await readSession(env.DB, 'another-secret', rawId, NOW + 1)).toBeNull();
  });

  it('an offboarded or unknown person gets no session row', async () => {
    await person('lp2', 'gone@practice.example', 1);
    const before = (await storedRows(env.DB, 'session')).length;
    for (const email of ['gone@practice.example', 'nobody@practice.example']) {
      await env.DB.exec((await localSession(email, SECRET, NOW)).sql);
    }
    expect((await storedRows(env.DB, 'session')).length).toBe(before);
    expect(await sessionsOf('lp2')).toBe(0);
  });

  it('only the generated dummy .dev.vars is used', async () => {
    const generated = dummySecrets(await dummyVars());
    expect(typeof generated).toBe('object');
    expect(dummySecrets(null)).toMatch(/missing/);
    expect(dummySecrets('SESSION_SECRET=real\nNOTE_KEK=real\n')).toMatch(/not the generated dummy/);
    expect(dummySecrets(`# ${DUMMY_MARKER}\nSESSION_SECRET=a\nNOTE_KEK=b\n`)).toMatch(/not the/);
    expect(dummySecrets(`${DUMMY_MARKER}\nNOTE_KEK=b\n`)).toMatch(/lacks/);
  });

  it('a fixture name maps to its fixture email and anything that could break the SQL is refused', () => {
    expect(localEmail('grid-phone')).toBe('grid-phone@practice.example');
    expect(localEmail('ada.lovelace@larkspur.example')).toBe('ada.lovelace@larkspur.example');
    for (const bad of ["x' OR 1=1 --", '', 'a b', '@x', 'a@b;c'])
      expect(localEmail(bad)).toBeNull();
  });
});
