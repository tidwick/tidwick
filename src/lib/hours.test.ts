import { describe, expect, it } from 'vitest';
import { DAY_CAP, formatHours, formatSignedHours, parseHours } from './hours';

describe('hours parsing and formatting', () => {
  it('typed decimals become integer hundredths', () => {
    expect(parseHours('7.5')).toBe(750);
    expect(parseHours('8')).toBe(800);
    expect(parseHours(' 0.25 ')).toBe(25);
    expect(parseHours('.5')).toBe(50);
    expect(parseHours('5.')).toBe(500);
    expect(parseHours('1,75')).toBe(175);
    expect(parseHours('')).toBe(0);
    expect(parseHours('   ')).toBe(0);
  });

  it('more than two places round half up on the decimal string, never through a float', () => {
    expect(parseHours('1.005')).toBe(101);
    expect(parseHours('1.0049')).toBe(100);
    expect(parseHours('0.285')).toBe(29);
    expect(parseHours('0.1349999')).toBe(13);
    expect(parseHours('24.004')).toBe(DAY_CAP);
    expect(parseHours('24.005')).toBe(DAY_CAP + 1);
  });

  it('anything that is not a non-negative decimal is rejected', () => {
    for (const bad of ['-1', '+1', '1e1', 'abc', '1.2.3', '.', ',', '1 2', '1h', '12345']) {
      expect(parseHours(bad), bad).toBeNull();
    }
  });

  it('formatting drops trailing zeros and round-trips what parsing makes', () => {
    expect(formatHours(0)).toBe('0');
    expect(formatHours(750)).toBe('7.5');
    expect(formatHours(800)).toBe('8');
    expect(formatHours(25)).toBe('0.25');
    expect(formatHours(5)).toBe('0.05');
    expect(formatHours(2400)).toBe('24');
    for (let h = 0; h <= DAY_CAP; h += 7) expect(parseHours(formatHours(h))).toBe(h);
  });

  it('a signed change spells out its direction and says 0 for none', () => {
    expect(formatSignedHours(150)).toBe('+1.5');
    expect(formatSignedHours(-25)).toBe('\u22120.25');
    expect(formatSignedHours(0)).toBe('0');
    expect(formatSignedHours(-400)).toBe('\u22124');
  });
});
