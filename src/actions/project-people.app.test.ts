// Runs in the `app` project: the project page reads every person only for a caller who holds a grant.
import { describe, expect, it } from 'vitest';
import { ACCOUNTING } from '../../test/helpers/auth';
import { booking } from '../../test/helpers/booking';
import { caller, getPage } from '../../test/helpers/callers';

describe('the project page and people', () => {
  it('a caller with a grant sees who can be added to the team', async () => {
    const b = await booking();
    const other = await caller();
    const steward = await caller([ACCOUNTING]);
    const res = await getPage(`/projects/${b.projectId}`, steward);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(other.personId);
  });

  it('a member sees no list of other people', async () => {
    const b = await booking();
    const other = await caller();
    const res = await getPage(`/projects/${b.projectId}`, b.who);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`/clients/${b.clientId}`);
    expect(html).not.toContain(other.personId);
  });
});
