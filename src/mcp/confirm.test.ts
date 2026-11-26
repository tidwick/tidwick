import { describe, expect, it } from 'vitest';
import { CONFIRM_MS, mintConfirm, openConfirm } from './confirm';

const SECRET = 'confirm-test-secret-not-real-at-all';
const who = { personId: 'p1', grantId: 'g1' };
const print = { n: 3, total: 1200, latest: 1_700_000_000_000 };
const NOW = 1_800_000_000_000;

describe('the submit confirmation', () => {
  it('opens to the fingerprint it was minted for, within ten minutes', async () => {
    const confirm = await mintConfirm(SECRET, who, '2026-01-05', print, NOW);
    expect(await openConfirm(SECRET, who, '2026-01-05', confirm, NOW + CONFIRM_MS - 1)).toEqual(
      print,
    );
  });

  it('refuses at ten minutes, for another week, person, grant or secret, and for any edit of its text', async () => {
    const confirm = await mintConfirm(SECRET, who, '2026-01-05', print, NOW);
    const open = (w = who, week = '2026-01-05', text = confirm, secret = SECRET, at = NOW + 1) =>
      openConfirm(secret, w, week, text, at);
    expect(await open(who, '2026-01-05', confirm, SECRET, NOW + CONFIRM_MS)).toBeNull();
    expect(await open(who, '2026-01-12')).toBeNull();
    expect(await open({ ...who, personId: 'p2' })).toBeNull();
    expect(await open({ ...who, grantId: 'g2' })).toBeNull();
    expect(await open(who, '2026-01-05', confirm, 'another-secret-another-secret-0000')).toBeNull();
    const [expires = '', text = '', tag = ''] = confirm.split('~');
    for (const parts of [
      [expires, '4.1200.1700000000000', tag],
      [expires, '3.1201.1700000000000', tag],
      [String(Number(expires) + 1), text, tag],
      [expires, text, tag.replace(/.$/, 'x')],
      [expires, text],
      [expires, text, tag, 'extra'],
      [expires, 'not-a-print', tag],
      ['', '', ''],
    ])
      expect(await open(who, '2026-01-05', parts.join('~')), parts.join('~')).toBeNull();
    expect(await open(who, '2026-01-05', '')).toBeNull();
  });
});
