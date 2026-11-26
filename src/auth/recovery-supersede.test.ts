// A recovery ends the old passkeys, sessions, identities and agent grants once the new passkey is added, and its own
// session is short.
import { describe, expect, it } from 'vitest';
import { mintAgent } from '../../test/helpers/agent';
import { deps, enrolledPerson, storedFor, T0, withIdentity } from '../../test/helpers/auth';
import { createSoftwareAuthenticator } from '../../test/helpers/software-authenticator';
import { liveGrantIdsOf } from '../db/agent-grants';
import { activeCredentialsOf } from '../db/credentials';
import { liveIdentitiesOf } from '../db/identities';
import { liveSessionCount } from '../db/sessions';
import { storedRows } from '../db/stored-rows';
import { addPasskeyOptions, completeAddPasskey } from './add-passkey';
import { recover } from './recovery';
import { ENROL_MS, newSession, readSession } from './session';

const actions = async () => (await storedRows(deps().db, 'audit_event')).map((e) => e.action);

describe('recovery supersedes the old access', () => {
  it('SEC-68 recovery ends the old passkeys, sessions, identities and agent grants, and leaves only the new ones', async () => {
    const person = await enrolledPerson();
    const d = deps();
    await withIdentity(person.personId, 'https://idp-a.example/a/v2.0', 'recovered-sub');
    const thief = await newSession(d.db, d.secret, person.personId, T0);
    await thief.statement.run();
    const agent = await mintAgent(person.personId);
    expect(await liveSessionCount(d.db, person.personId, T0)).toBeGreaterThan(1);

    const { sessionId } = await recover(d, person.email, person.codes[7] ?? '', T0);
    expect(await readSession(d.db, d.secret, thief.rawId, T0)).toBeNull();
    expect(await readSession(d.db, d.secret, person.sessionId, T0)).toBeNull();
    expect(await activeCredentialsOf(d.db, person.personId)).toHaveLength(1);
    const session = await readSession(d.db, d.secret, sessionId, T0);
    expect(session).toMatchObject({ mustEnrol: true });
    const [recovering] = (await storedFor('session', person.personId)).filter(
      (row) => row.must_enrol === 1,
    );
    expect(recovering?.expires_at).toBe(T0 + ENROL_MS);
    if (!session) return;

    const fresh = await createSoftwareAuthenticator();
    const { options, challengeId } = await addPasskeyOptions(d, session, T0);
    const registration = await fresh.register(options, d.rp.origin);
    const added = await completeAddPasskey(d, session, challengeId, registration, T0);
    const kept = await activeCredentialsOf(d.db, person.personId);
    expect(kept.map((c) => c.id)).toEqual([registration.id]);
    expect(await liveSessionCount(d.db, person.personId, T0)).toBe(1);
    expect(await readSession(d.db, d.secret, added.sessionId ?? '', T0)).toMatchObject({
      mustEnrol: false,
    });
    expect(await liveIdentitiesOf(d.db, person.personId)).toEqual([]);
    expect(await liveGrantIdsOf(d.db, person.personId)).toEqual([]);
    expect(agent.grantId).not.toBe('');
    const names = await actions();
    for (const name of [
      'people.revokeCredentials',
      'people.revokeSessions',
      'people.unlinkSso',
      'agents.revoke',
    ])
      expect(names).toContain(name);
  });

  it('SEC-68 an abandoned recovery leaves the old passkeys in place, and its session lapses after 30 minutes', async () => {
    const person = await enrolledPerson();
    const d = deps();
    const { sessionId } = await recover(d, person.email, person.codes[8] ?? '', T0);
    expect(await activeCredentialsOf(d.db, person.personId)).toHaveLength(1);
    expect(await readSession(d.db, d.secret, sessionId, T0 + ENROL_MS - 1)).not.toBeNull();
    expect(await readSession(d.db, d.secret, sessionId, T0 + ENROL_MS)).toBeNull();
  });
});
