import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminGrants, rowCounts, seizeAttempt } from './test-support-bootstrap';

// Its own file, so its database starts empty: an admin grant with no audit event at all.
describe('first admin bootstrap against an admin', () => {
  it('SEC-29 a bootstrap writes nothing into a database with an admin grant and an empty log', async () => {
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
    expect((await rowCounts(env.DB)).audit_event).toBe(0);
    const { before, after } = await seizeAttempt(env.DB);
    expect(after).toEqual(before);
    expect(await adminGrants(env.DB)).toBe(1);
  });
});
