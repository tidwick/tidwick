// Runs in the `app` project: where the provider buttons, the provider confirmation and the admin's view of
// sign-in methods appear, and the Action that unlinks one.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, addPerson, MINUTE, storedFor } from '../../test/helpers/auth';
import { caller, formPost, getPage } from '../../test/helpers/callers';
import type { MockIdp } from '../../test/helpers/mock-idp';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { idpForConfigured, link } from '../../test/helpers/sso';

let idp: MockIdp;
beforeEach(async () => {
  idp = await idpForConfigured();
});
afterEach(() => {
  idp.restore();
});

/** The page's markup with the entity Astro writes for `&` in an attribute read back as `&`. */
const html = async (response: Response): Promise<string> =>
  (await response.text()).replaceAll('&#' + '38;', '&').replaceAll('&' + 'amp;', '&');

describe('SEC-44 the provider buttons are links beside the passkey ones', () => {
  it('the sign-in page lists one link per provider and keeps the passkey button', async () => {
    const page = await html(await getPage('/login', null));
    expect(page).toContain('data-passkey="login"');
    for (const [id, label] of [
      ['tenant-a', 'Tenant A'],
      ['tenant-b', 'Tenant B'],
      ['google', 'Google'],
    ]) {
      expect(page).toContain(`href="/auth/sso/login?provider=${id}"`);
      expect(page).toContain(`Sign in with ${label}`);
    }
    expect(page).not.toMatch(/<form[^>]*sso/);
  });

  it('an enrolment page offers each provider beside the passkey, carrying its link', async () => {
    const page = await html(await getPage('/enrol/abc-123_X', null));
    expect(page).toContain('data-passkey="enrol"');
    expect(page).toContain('href="/auth/sso/enrol?provider=tenant-a&token=abc-123_X"');
  });
});

describe('SEC-45 the step-up prompt offers the provider the person signs in with', () => {
  it('shows a confirmation link for a person with an identity, and none for one without', async () => {
    const linked = await caller([ADMIN], { stepUpAgo: 20 * MINUTE });
    await link(linked.personId, 'tenant-b', 'p1');
    const target = (await addPerson()).id;
    const page = await html(await getPage(`/admin/people/${target}`, linked));
    expect(page).toContain('data-step-up="needed"');
    expect(page).toContain('Confirm with Tenant B');
    expect(page).toContain(
      `href="/auth/sso/step-up?provider=tenant-b&return=%2Fadmin%2Fpeople%2F${target}"`,
    );
    expect(page).not.toContain('Confirm with Tenant A');
    expect(page).toContain('Confirm with your sign-in provider');
    const plain = await caller([ADMIN], { stepUpAgo: 20 * MINUTE });
    const other = await html(await getPage(`/admin/people/${target}`, plain));
    expect(other).not.toContain('/auth/sso/step-up');
    expect(other).toContain('Confirm with your passkey');
  });
});

describe('SEC-46 an admin sees and unlinks a person’s identity', () => {
  it('lists it with its provider and email, and Unlink revokes it, audited, only for an admin who has confirmed', async () => {
    const admin = await caller([ADMIN]);
    const person = await addPerson();
    const identity = await link(person.id, 'tenant-a', 'u1');
    await env.DB.prepare('UPDATE person_identity SET email = ?2 WHERE id = ?1')
      .bind(identity, 'u1@x.example')
      .run();
    const page = await html(await getPage(`/admin/people/${person.id}`, admin));
    expect(page).toContain('Sign-in methods');
    expect(page).toContain('Tenant A');
    expect(page).toContain('u1@x.example');

    const member = await caller();
    const fields = { id: person.id, identity };
    expect(
      (await formPost(`/admin/people/${person.id}`, 'people.unlinkSso', member, fields)).status,
    ).toBe(403);
    const stale = await caller([ADMIN], { stepUpAgo: 20 * MINUTE });
    expect(
      (await formPost(`/admin/people/${person.id}`, 'people.unlinkSso', stale, fields)).status,
    ).toBe(403);
    expect(await storedFor('person_identity', person.id)).toMatchObject([{ revoked_at: null }]);

    const seq = await headSeq();
    const done = await formPost(`/admin/people/${person.id}`, 'people.unlinkSso', admin, fields);
    expect(done.status).toBe(303);
    expect(await storedFor('person_identity', person.id)).toMatchObject([
      { revoked_at: expect.any(Number) as number },
    ]);
    expect((await eventsAfter(seq)).map((e) => e.action)).toEqual(['people.unlinkSso']);
    expect(await html(await getPage(`/admin/people/${person.id}`, admin))).toContain(
      'No linked identity provider accounts',
    );
  });

  it('the people list says a person who has only an identity signs in through single sign-on', async () => {
    const admin = await caller([ADMIN]);
    const person = await addPerson();
    await link(person.id, 'tenant-a', 'u2');
    expect(await html(await getPage('/admin/people', admin))).toContain('Single sign-on');
  });
});
