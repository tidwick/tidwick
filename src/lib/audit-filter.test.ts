import { describe, expect, it } from 'vitest';
import { auditQuery, filterQuery, nextPageQuery } from './audit-filter';

const parse = (query: string) => auditQuery(new URLSearchParams(query));

describe('the audit page reads its filters from the address', () => {
  it('no query means no filter and the first page', () => {
    expect(parse('')).toEqual({
      filter: { from: null, to: null, actor: null, client: null, action: null, target: null },
      before: null,
      problem: null,
    });
  });

  it('each filter is read, trimmed, and a blank one is no filter', () => {
    const { filter, before, problem } = parse(
      'from=2026-03-01&to=2026-03-31&actor=abc&client=&action=%20settings.&target=client%3A1&before=40',
    );
    expect(filter).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
      actor: 'abc',
      client: null,
      action: 'settings.',
      target: 'client:1',
    });
    expect([before, problem]).toEqual([40, null]);
  });

  it('a date that is not a real day, or a range that runs backward, is dropped and named', () => {
    for (const bad of ['from=2026-02-30', 'to=yesterday', 'from=2026-04-02&to=2026-04-01']) {
      const { filter, problem } = parse(bad);
      expect(problem, bad).toMatch(/date/i);
      expect([filter.from, filter.to], bad).toEqual([null, null]);
    }
  });

  it('a page cursor that is not a positive whole number is dropped, and an over-long text is cut off', () => {
    for (const bad of ['before=0', 'before=-3', 'before=2.5', 'before=x']) {
      expect(parse(bad).before, bad).toBeNull();
    }
    expect(parse(`action=${'a'.repeat(500)}`).filter.action).toHaveLength(100);
  });

  it('the next page keeps the filters and moves the cursor, leaving the posted action out', () => {
    const params = new URLSearchParams('from=2026-03-01&actor=abc&before=90&_action=audit.verify');
    expect(nextPageQuery(params, 41)).toBe('from=2026-03-01&actor=abc&before=41');
  });

  it('a link to the same filters carries neither the cursor nor the posted action', () => {
    const params = new URLSearchParams('target=client%3A&before=9&_action=audit.verify&x=1');
    expect(filterQuery(params).toString()).toBe('target=client%3A');
  });
});
