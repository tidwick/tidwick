import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

// Written by test/e2e/prepare.ts, which `just e2e` runs first: one open enrolment link per synthetic person.
const tokens = JSON.parse(readFileSync('.wrangler/e2e-tokens.json', 'utf8')) as Record<
  string,
  string
>;

/** The open enrolment link's token for a person prepare.ts made, such as `grid-phone`. */
export const tokenOf = (name: string): string => tokens[name] ?? '';

/** Gives the page a virtual authenticator, opens the link and creates a passkey, to the recovery-codes step. */
export async function startEnrol(page: Page, token: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(`/enrol/${token}`);
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
}

/** Ticks the box that says the codes are saved, which enables Continue, and leaves for the week page. */
export async function finishEnrol(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /I have saved these codes/ }).check();
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/week/);
}

/** Enrols the person through their link, ticking the recovery-codes box, and lands on the week page. */
export async function enrol(page: Page, token: string): Promise<void> {
  await startEnrol(page, token);
  await finishEnrol(page);
}
