// Runs in the `app` project: new recovery codes survive a reload of the account page until acknowledged.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { pendingCodesOf, PENDING_CODES_MS } from '../../db/pending-codes';

const CODE = /[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}/g;
const codesOn = async (html: Response) => (await html.text()).match(CODE) ?? [];

describe('new recovery codes outlive the POST that made them', () => {
  it('a form post redirects to the account page, which shows the codes again on every reload, uncached', async () => {
    const who = await caller();
    const posted = await formPost('/account', 'auth.regenerateCodes', who);
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe('/account');
    expect(await posted.text()).not.toMatch(CODE);

    const first = await getPage('/account', who);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const shown = await codesOn(first);
    expect(shown).toHaveLength(10);
    expect(await codesOn(await getPage('/account', who))).toEqual(shown);
  });

  it('acknowledging clears them: the page stops showing them and the record is gone', async () => {
    const who = await caller();
    await rpcForm('auth.regenerateCodes', who);
    expect(await pendingCodesOf(env.DB, who.personId, Date.now())).toHaveLength(10);
    const ack = await formPost('/account', 'auth.ackCodes', who);
    expect(ack.status).toBe(303);
    expect(ack.headers.get('location')).not.toMatch(CODE);
    expect(await codesOn(await getPage('/account', who))).toEqual([]);
    expect(await pendingCodesOf(env.DB, who.personId, Date.now())).toEqual([]);
  });

  it('shows nothing once the record is ten minutes old', async () => {
    const who = await caller();
    await rpcForm('auth.regenerateCodes', who);
    const later = Date.now() + PENDING_CODES_MS + 1000;
    expect(await pendingCodesOf(env.DB, who.personId, later)).toEqual([]);
  });

  it("another person's acknowledgement leaves mine alone, and mine is never on their page", async () => {
    const mine = await caller();
    const theirs = await caller();
    await rpcForm('auth.regenerateCodes', mine);
    await formPost('/account', 'auth.ackCodes', theirs);
    expect(await codesOn(await getPage('/account', mine))).toHaveLength(10);
    expect(await codesOn(await getPage('/account', theirs))).toEqual([]);
  });

  it('a second batch replaces the first', async () => {
    const who = await caller();
    await rpcForm('auth.regenerateCodes', who);
    const first = await pendingCodesOf(env.DB, who.personId, Date.now());
    await rpcForm('auth.regenerateCodes', who);
    const second = await pendingCodesOf(env.DB, who.personId, Date.now());
    expect(second).toHaveLength(10);
    expect(second.some((c) => first.includes(c))).toBe(false);
  });
});
