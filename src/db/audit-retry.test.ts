import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryOnce, retryWhileOpen } from './audit';

const permanent = () =>
  new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT: note-secret-123');

afterEach(() => vi.restoreAllMocks());

describe('a write that keeps failing a constraint', () => {
  it('retryOnce runs twice, logs the D1 error, then reports conflict', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let runs = 0;
    await expect(
      retryOnce(() => {
        runs++;
        return Promise.reject(permanent());
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(runs).toBe(2);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.join(' '))).toMatch(/constraint/i);
    expect(String(log.mock.calls[0]?.join(' '))).not.toContain('note-secret-123');
  });

  it('retryWhileOpen logs the D1 error before conflict', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      retryWhileOpen(
        () => Promise.reject(permanent()),
        () => Promise.resolve(true),
        () => {
          throw new Error('gone');
        },
        2,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(log).toHaveBeenCalledOnce();
  });

  it('a success logs nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(retryOnce(() => Promise.resolve(1))).resolves.toBe(1);
    expect(log).not.toHaveBeenCalled();
  });
});
