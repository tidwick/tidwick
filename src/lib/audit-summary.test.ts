import { describe, expect, it } from 'vitest';
import { changeLines } from './audit-summary';

describe('the audit page says what an event changed', () => {
  it('a renamed record reads as its field with the value before and after', () => {
    expect(changeLines('{"name":"Old"}', '{"name":"New"}')).toEqual(['name: Old → New']);
  });

  it('a created record lists its fields, and a removed one says each went to none', () => {
    expect(changeLines(null, '{"name":"New","number":null}')).toEqual([
      'name: New',
      'number: none',
    ]);
    expect(changeLines('{"name":"Old"}', null)).toEqual(['name: Old → none']);
  });

  it('a setting reads as one value before and after', () => {
    expect(changeLines('30', '"ops@example.net"')).toEqual(['value: 30 → ops@example.net']);
    expect(changeLines(null, 'true')).toEqual(['value: true']);
  });

  it('a cell edit shows hours, and a changed note as the words "note changed", never its ciphertext', () => {
    const before = '{"hundredths":150,"note_ct":"aabbccdd"}';
    const after = '{"hundredths":200,"note_ct":"11223344"}';
    const lines = changeLines(before, after);
    expect(lines).toEqual(['hours: 1.5 → 2', 'note changed']);
    expect(lines.join(' ')).not.toMatch(/aabbccdd|11223344/);
    expect(changeLines(before, '{"hundredths":200,"note_ct":"aabbccdd"}')).toEqual([
      'hours: 1.5 → 2',
    ]);
    expect(changeLines(null, '{"hundredths":50,"note_ct":null}')).toEqual(['hours: 0.5']);
    expect(changeLines(null, '{"hundredths":50,"note_ct":"aa"}')).toEqual([
      'hours: 0.5',
      'note changed',
    ]);
  });

  it('a list reads as its items, a long value is cut, and text that is not JSON is shown as it is, cut', () => {
    expect(changeLines('{"task_codes":[]}', '{"task_codes":["DES","SUR"]}')).toEqual([
      'task_codes: none → DES, SUR',
    ]);
    const long = 'x'.repeat(200);
    const [line] = changeLines(null, JSON.stringify({ name: long }));
    expect(line?.length).toBeLessThan(100);
    expect(line?.endsWith('…')).toBe(true);
    expect(changeLines(null, 'not json')[0]).toBe('value: not json');
  });

  it('an event with neither side has no lines', () => {
    expect(changeLines(null, null)).toEqual([]);
  });
});
