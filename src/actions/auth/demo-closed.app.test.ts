// Runs in the `app` project: the built Worker has none of the demo's signals, so its sign-in is a route that
// does not exist.
import { describe, expect, it } from 'vitest';
import { formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { DEMO_PERSONAS } from '../../lib/demo-personas';

describe('the demo sign-in outside the demo', () => {
  it('GET /demo is 404 with no body', async () => {
    const response = await getPage('/demo', null);
    expect(response.status).toBe(404);
    const unknown = await getPage('/no-such-page', null);
    expect(await response.text()).toBe(await unknown.text());
  });

  it('auth.demoSignin opens no session even with a password and a persona, as a script call or a form', async () => {
    const fields = { password: 'a-long-demo-password', persona: DEMO_PERSONAS[3].key };
    const script = await rpcForm('auth.demoSignin', null, fields);
    expect(script.status).toBe(404);
    expect(script.headers.getSetCookie()).toEqual([]);
    const form = await formPost('/demo', 'auth.demoSignin', null, fields);
    expect(form.status).toBe(404);
    expect(form.headers.getSetCookie()).toEqual([]);
  });
});
