// The catalog boundary every Action runs inside: what leaves an Action is a catalog entry, whatever was thrown.
import { ActionError } from 'astro:actions';
import { describe, expect, it, vi } from 'vitest';
import { secrets } from '../../test/helpers/probe-secrets';
import { CATALOG, fail } from '../lib/errors';
import { act } from './context';

async function thrownBy(body: () => Promise<unknown>): Promise<unknown> {
  try {
    await act(body);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('act', () => {
  it("a non-catalog error leaves an Action as the catalog's generic message, never the raw text", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = 'D1_ERROR: UNIQUE constraint failed: entry.row_id, entry.dow';
    const leaving = await thrownBy(() => Promise.reject(new Error(raw)));
    expect(leaving).toBeInstanceOf(ActionError);
    const action = leaving as ActionError;
    expect(action.code).toBe('INTERNAL_SERVER_ERROR');
    expect(action.message).toBe(CATALOG.internal.message);
    expect(action.message).not.toContain('D1_ERROR');
    expect(log).toHaveBeenCalledTimes(1);

    log.mockClear();
    const known = (await thrownBy(() => Promise.resolve(fail('locked')))) as ActionError;
    expect(known.code).toBe('FORBIDDEN');
    expect(known.message).toBe(CATALOG.locked.message);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('the operator log of a failed Action carries no secret thrown as its message or cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [kind, secret] of Object.entries(secrets())) {
      for (const thrown of [new Error(secret), new Error('wrapped', { cause: secret })]) {
        log.mockClear();
        const leaving = (await thrownBy(() => Promise.reject(thrown))) as ActionError;
        expect(leaving.message, kind).toBe(CATALOG.internal.message);
        expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.mock.calls), kind).not.toContain(secret);
        expect(String(log.mock.calls[0]?.[1]), kind).toBe('Error');
      }
    }
    log.mockRestore();
  });
});
