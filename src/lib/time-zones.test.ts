import { describe, expect, it } from 'vitest';
import { isTimeZone, timeZoneChoices } from './time-zones';

describe('time zones', () => {
  it('a known zone and an alias are time zones; a blank, a made-up name and an offset string are not', () => {
    expect(isTimeZone('Europe/Lisbon')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('not a zone')).toBe(false);
  });

  it('the choices start with UTC once, and keep a saved zone the runtime does not list', () => {
    const choices = timeZoneChoices('UTC');
    expect(choices[0]).toBe('UTC');
    expect(choices.filter((zone) => zone === 'UTC')).toHaveLength(1);
    expect(choices).toContain('Europe/Lisbon');
    expect(timeZoneChoices('Etc/Unlisted')[0]).toBe('Etc/Unlisted');
  });
});
