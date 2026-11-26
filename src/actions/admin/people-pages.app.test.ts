// The person page: the edit form and its step-up on an email change, the confirm step before Offboard and
// Re-enrol (no script needed), Reinstate for an offboarded person, and the people form keeping its Firm.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN, MINUTE, storedFor } from '../../../test/helpers/auth';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { personById } from '../../db/people';

const HOME = 'f-home';
const text = async (path: string, who: Awaited<ReturnType<typeof caller>>) =>
  (await getPage(path, who)).text();

describe('people.update through the Action', () => {
  it('an email change needs a fresh passkey confirmation; a name change does not', async () => {
    const stale = await caller([ADMIN], { stepUpAgo: 20 * MINUTE });
    const fresh = await caller([ADMIN]);
    const target = await caller([]);
    const was = await personById(env.DB, target.personId);
    const fields = {
      id: target.personId,
      name: 'Edited Name',
      email: was?.email ?? '',
      firmId: HOME,
    };

    expect((await rpcForm('people.update', stale, fields)).status).toBe(200);
    expect((await personById(env.DB, target.personId))?.name).toBe('Edited Name');

    const moved = { ...fields, email: 'moved.person@practice.example' };
    const refused = await rpcForm('people.update', stale, moved);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('Confirm with your passkey');
    expect((await personById(env.DB, target.personId))?.email).toBe(was?.email);

    expect((await rpcForm('people.update', fresh, moved)).status).toBe(200);
    expect((await personById(env.DB, target.personId))?.email).toBe(
      'moved.person@practice.example',
    );
  });

  it('a refused save shows the typed values and the message on the page', async () => {
    const admin = await caller([ADMIN]);
    const taken = await caller([]);
    const target = await caller([]);
    const takenEmail = (await personById(env.DB, taken.personId))?.email ?? '';
    const posted = await formPost(`/admin/people/${target.personId}`, 'people.update', admin, {
      id: target.personId,
      name: 'Typed Name',
      email: takenEmail,
      firmId: HOME,
    });
    const html = await posted.text();
    expect(html).toContain('value="Typed Name"');
    expect(html).toContain(`value="${takenEmail}"`);
  });
});

describe('Offboard and Re-enrol ask first, without script', () => {
  it('the person page links to a confirm step and posts nothing until its button', async () => {
    const admin = await caller([ADMIN]);
    const target = await caller([]);
    const path = `/admin/people/${target.personId}`;
    const plain = await text(path, admin);
    expect(plain).not.toContain('_action=people.offboard');
    expect(plain).not.toContain('_action=people.reenrol');
    expect(plain).toContain('href="?confirm=offboard#confirm"');
    expect(plain).toContain('href="?confirm=reenrol#confirm"');

    const off = await text(`${path}?confirm=offboard`, admin);
    expect(off).toContain('Confirm offboard');
    expect(off).toContain('_action=people.offboard');
    expect(off).toContain('Cancel');
    const re = await text(`${path}?confirm=reenrol`, admin);
    expect(re).toContain('Confirm re-enrol');
    expect(re).toContain('_action=people.reenrol');
    expect(await text(`${path}?confirm=nonsense`, admin)).not.toContain('Confirm offboard');
    expect((await personById(env.DB, target.personId))?.offboarded_at).toBeNull();
  });

  it('an offboarded person offers Reinstate, which lifts it and leaves them without access', async () => {
    const admin = await caller([ADMIN]);
    const target = await caller([]);
    const path = `/admin/people/${target.personId}`;
    const off = await formPost(path, 'people.offboard', admin, { id: target.personId });
    expect(off.status).toBe(303);
    const page = await text(`${path}?confirm=offboard`, admin);
    expect(page).toContain('_action=people.reinstate');
    expect(page).not.toContain('Confirm offboard');
    const back = await formPost(path, 'people.reinstate', admin, { id: target.personId });
    expect(back.status).toBe(303);
    expect((await personById(env.DB, target.personId))?.offboarded_at).toBeNull();
    const live = (await storedFor('credential', target.personId)).filter(
      (r) => r.revoked_at === null,
    );
    expect(live).toEqual([]);
  });
});

describe('a refused New person form keeps its Firm', () => {
  it('the chosen firm stays selected', async () => {
    const admin = await caller([ADMIN]);
    const posted = await formPost('/admin/people', 'people.create', admin, {
      name: 'No Mail',
      email: 'not-an-email',
      firmId: HOME,
    });
    expect(await posted.text()).toContain(`value="${HOME}" selected`);
  });
});
