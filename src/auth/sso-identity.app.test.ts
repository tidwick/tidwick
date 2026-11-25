// Runs in the `app` project: an identity is the issuer and subject, and only a person's own enrolment link makes one.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPerson, adminScope, storedFor } from '../../test/helpers/auth';
import type { MockIdp } from '../../test/helpers/mock-idp';
import {
  attempt,
  callback,
  idpForConfigured,
  link,
  linked,
  refused,
  start,
} from '../../test/helpers/sso';
import { revokeIdentitiesOf } from '../db/identities';
import { stampOffboarded } from '../db/test-support';
import { currentEnv } from '../lib/env';
import { issueEnrolment } from './enrol';

let idp: MockIdp;
beforeEach(async () => {
  idp = await idpForConfigured();
});
afterEach(() => {
  idp.restore();
});

const { SESSION_SECRET } = currentEnv();

describe('SEC-42 an identity is the issuer and subject, and only a person’s own link makes one', () => {
  it('an account no one linked is unlinked, even when its email is a person’s own', async () => {
    const who = await addPerson();
    refused(
      await attempt(idp, { subject: 'nobody', email: who.email, claims: { email_verified: true } }),
      403,
    );
    expect(await storedFor('person_identity', who.id)).toEqual([]);
  });

  it('an offboarded person and a revoked identity both sign in as unlinked', async () => {
    const gone = await linked('o1');
    await stampOffboarded(env.DB, gone);
    refused(await attempt(idp, { subject: 'o1' }), 403);
    const revoked = await linked('o2');
    await revokeIdentitiesOf(env.DB, revoked, Date.now()).run();
    refused(await attempt(idp, { subject: 'o2' }), 403);
  });

  it('an enrolment link cannot take an account that is live for another person, or add a second at one issuer', async () => {
    await linked('t1');
    const first = await addPerson();
    const token = await issueEnrolment(
      await adminScope(),
      env.DB,
      SESSION_SECRET,
      first.id,
      Date.now(),
    );
    const path = `/auth/sso/enrol?provider=tenant-a&token=${token}`;
    refused(await attempt(idp, { subject: 't1' }, undefined, path), 409);
    await link(first.id, 'tenant-a', 't2');
    refused(await attempt(idp, { subject: 't3' }, undefined, path), 409);
    expect(await storedFor('person_identity', first.id)).toHaveLength(1);
  });

  it('an enrolment link works once, whichever way it is used', async () => {
    const who = await addPerson();
    const token = await issueEnrolment(
      await adminScope(),
      env.DB,
      SESSION_SECRET,
      who.id,
      Date.now(),
    );
    const path = `/auth/sso/enrol?provider=tenant-a&token=${token}`;
    const first = await start(path);
    const second = await start(path);
    expect(
      (await callback(idp.authorize(first.location, { subject: 'e1' }), first.flow)).status,
    ).toBe(200);
    refused(await callback(idp.authorize(second.location, { subject: 'e2' }), second.flow), 410);
    expect((await start(path)).response.status).toBe(410);
    expect(await storedFor('person_identity', who.id)).toHaveLength(1);
  });
});
