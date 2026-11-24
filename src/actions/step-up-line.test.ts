// Runs in the `app` project: the passkey confirmation on a page is one muted line while a confirmation is
// current, and the full panel with its explanation once it is missing or expired, since that is when it must be seen.
import { describe, expect, it } from 'vitest';
import { ACCOUNTING } from '../../test/helpers/auth';
import { caller, getPage } from '../../test/helpers/callers';

const MINUTE = 60_000;
const PAGES = ['/approvals', '/import'];

describe('the passkey confirmation shows as one line when current and as a panel when not', () => {
  it('a current confirmation is one line with a Confirm again button and no panel heading', async () => {
    const who = await caller([ACCOUNTING], { stepUpAgo: MINUTE });
    for (const path of PAGES) {
      const html = await (await getPage(path, who)).text();
      expect(html, path).toContain('data-step-up="current"');
      expect(html, path).toMatch(/Passkey confirmed until \d\d:\d\d UTC\./);
      expect(html, path).toContain('Confirm again');
      expect(html, path).not.toContain('id="step-up-h"');
      expect(html, path).not.toContain('data-step-up="needed"');
    }
  });

  it('an expired confirmation shows the full panel with what it unlocks', async () => {
    const who = await caller([ACCOUNTING], { stepUpAgo: 16 * MINUTE });
    for (const path of PAGES) {
      const html = await (await getPage(path, who)).text();
      expect(html, path).toContain('data-step-up="needed"');
      expect(html, path).toContain('Confirm with your passkey');
      expect(html, path).toContain('is needed for');
      expect(html, path).not.toContain('data-step-up="current"');
    }
  });
});
