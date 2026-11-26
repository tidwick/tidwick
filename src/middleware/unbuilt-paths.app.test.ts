// Runs in the `app` project: a path nobody built is a 404 for a signed-out visitor and a signed-in one alike, never a
// refusal that hints a page might exist, and `/mcp` has its own row, so a path under it is such a path too.
import { describe, expect, it } from 'vitest';
import { caller, getPage } from '../../test/helpers/callers';
import { PAGES } from '../routes';

describe('a path nobody built', () => {
  it('answers 404 signed out and signed in, with no route-table row', async () => {
    const member = await caller();
    for (const path of ['/no-such-page', '/mcp/tools', '/oauth/token']) {
      expect((await getPage(path, null)).status, path).toBe(404);
      expect((await getPage(path, member)).status, path).toBe(404);
      expect(PAGES).not.toHaveProperty(path);
    }
  });
});
