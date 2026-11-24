// Searching the people and approvals lists over the 100-person seed. Expected counts come from how the seed is
// built (ten first names across ten surnames, two firms of 60 and 40), not from the functions under test.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../test/seed/build';
import { loadSeed } from '../../test/seed/load';
import { submittedStatements } from '../../test/seed/submitted';
import { currentEnv } from '../lib/env';
import { submittedWeeks } from './approvals';
import { listPeople } from './people';
import { scopeFor } from './scope';

describe('searching the people list over the 100-person seed', () => {
  beforeAll(async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
  });

  it('no term lists all 100 people', async () => {
    expect(await listPeople(env.DB)).toHaveLength(100);
    expect(await listPeople(env.DB, '')).toHaveLength(100);
  });

  it('a first name finds the ten people who share it, whatever its case', async () => {
    const found = await listPeople(env.DB, 'cORa');
    expect(found).toHaveLength(10);
    expect(found.every((p) => p.name.startsWith('Cora '))).toBe(true);
  });

  it('a term finds a person by name, email, accounting code or firm', async () => {
    expect((await listPeople(env.DB, 'Dev Brightwell')).map((p) => p.email)).toEqual([
      'dev.brightwell@larkspur.example',
    ]);
    expect(await listPeople(env.DB, 'iris.juniper@brindle')).toHaveLength(1);
    expect((await listPeople(env.DB, 'R1005')).map((p) => p.name)).toEqual(['Felix Abernath']);
    expect(await listPeople(env.DB, 'Brindle Works')).toHaveLength(40);
  });

  it('percent, underscore and quote are text, not wildcards or SQL, and match nobody', async () => {
    for (const term of ['%', '_', 'ada%', "'; DROP TABLE person; --", '\\', 'a_a']) {
      expect(await listPeople(env.DB, term), term).toHaveLength(0);
    }
    expect(await listPeople(env.DB)).toHaveLength(100);
  });

  it('a term nobody holds finds nobody', async () => {
    expect(await listPeople(env.DB, 'zzzz')).toEqual([]);
  });
});

describe('searching the approvals list over the 100-person seed', () => {
  beforeAll(async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
    await env.DB.exec(
      [...submittedStatements('2026-11-09', 30), ...submittedStatements('2026-11-02', 10)].join(
        '\n',
      ),
    );
  });

  it('a name keeps that person’s weeks and drops everyone else’s', async () => {
    const admin = await scopeFor(env.DB, SEED_IDS.person(1));
    const all = await submittedWeeks(admin, env.DB);
    expect(all).toHaveLength(40);
    // The submitters are the 4th to the 33rd person; Dev is every tenth from the 4th, and the first ten submit twice.
    const dev = await submittedWeeks(admin, env.DB, 'dev ');
    expect(dev).toHaveLength(4);
    expect(new Set(dev.map((w) => w.person_id))).toEqual(
      new Set([SEED_IDS.person(4), SEED_IDS.person(14), SEED_IDS.person(24)]),
    );
  });

  it('an email or accounting code finds a person, and a term nobody holds finds nothing', async () => {
    const admin = await scopeFor(env.DB, SEED_IDS.person(1));
    expect(await submittedWeeks(admin, env.DB, 'elin.abernath@larkspur')).toHaveLength(2);
    expect(await submittedWeeks(admin, env.DB, 'R1003')).toHaveLength(2);
    expect(await submittedWeeks(admin, env.DB, 'zzzz')).toEqual([]);
    expect(await submittedWeeks(admin, env.DB, '%')).toEqual([]);
  });

  it('a member scope is refused a search as it is refused the list', async () => {
    const member = await scopeFor(env.DB, SEED_IDS.person(3));
    await expect(submittedWeeks(member, env.DB, 'dev')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
