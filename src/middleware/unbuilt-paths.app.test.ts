// Runs in the `app` project: /mcp was cut from 0.1 (an agent surface is planned after it), so it is a path nobody
// built, and a path nobody built is a 404 for a signed-out visitor and a signed-in one alike, never a refusal that
// hints a page might exist. `just live` expects the demo to answer /mcp that way.
import { describe, expect, it } from 'vitest';
import { caller, getPage } from '../../test/helpers/callers';
import { PAGES } from '../routes';

describe('a path nobody built', () => {
  it('answers 404 signed out and signed in, /mcp included, which has no route-table row', async () => {
    const member = await caller();
    for (const path of ['/mcp', '/no-such-page', '/mcp/tools']) {
      expect((await getPage(path, null)).status, path).toBe(404);
      expect((await getPage(path, member)).status, path).toBe(404);
    }
    expect(PAGES).not.toHaveProperty('/mcp');
  });
});
