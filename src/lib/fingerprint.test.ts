import { describe, expect, it } from 'vitest';
import { fingerprintText, parseFingerprint } from './fingerprint';

describe('the week fingerprint as form text', () => {
  it('round-trips, and refuses text that is not one', () => {
    const print = { n: 3, total: 1250, latest: 1_780_000_000_000 };
    expect(parseFingerprint(fingerprintText(print))).toEqual(print);
    expect(parseFingerprint('0.0.0')).toEqual({ n: 0, total: 0, latest: 0 });
    for (const bad of ['', '1.2', '1.2.3.4', 'a.b.c', '-1.2.3', '1.2.3 ']) {
      expect(parseFingerprint(bad), bad).toBeNull();
    }
  });
});
