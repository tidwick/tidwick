import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instanceEmpty } from './empty';

// Its own file, so its database starts empty.
describe('an instance with no owner', () => {
  it('an empty migrated database is empty; one admin grant alone makes it not', async () => {
    expect(await instanceEmpty(env.DB)).toBe(true);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO client (id, name, created_at) VALUES ('c0', 'Home', 1)"),
      env.DB.prepare("INSERT INTO firm (id, name, client_id) VALUES ('f0', 'Home', 'c0')"),
      env.DB.prepare(
        "INSERT INTO person (id, firm_id, email, name, created_at) VALUES ('p0', 'f0', 'owner@example.test', 'Owner', 1)",
      ),
      env.DB.prepare(
        "INSERT INTO person_role (person_id, role, granted_at) VALUES ('p0', 'admin', 1)",
      ),
    ]);
    expect(await instanceEmpty(env.DB)).toBe(false);
  });
});
