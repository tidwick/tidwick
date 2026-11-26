// The agent routes count in the existing RATE_LIMIT binding (30 per 60 s per key): a tool call per person once its
// token verifies, and a failed token lookup per address. A burst is made first so it cannot straddle a window roll.
import { describe, expect, it } from 'vitest';
import { call2025, mcp, mintAgent } from '../../test/helpers/agent';
import { addPerson } from '../../test/helpers/auth';
import { randomToken } from '../auth/tokens';

describe('SEC-63 agent rate limits', () => {
  it('SEC-63 the 31st tool call of one person in a minute is refused as rate_limited, and another person is not (negative case: the first 30 pass)', async () => {
    const busy = await mintAgent((await addPerson()).id);
    const calm = await mintAgent((await addPerson()).id);
    const results: boolean[] = [];
    let last = '';
    for (let i = 0; i < 31; i += 1) {
      const response = await mcp(busy.token, call2025('list_projects'));
      const result = response.body.result as { isError?: boolean; content: { text: string }[] };
      results.push(result.isError === true);
      last = result.content[0]?.text ?? '';
    }
    expect(results.slice(0, 30).filter(Boolean)).toEqual([]);
    expect(results[30]).toBe(true);
    expect(JSON.parse(last)).toMatchObject({ error: 'rate_limited' });
    const other = await mcp(calm.token, call2025('list_projects'));
    expect((other.body.result as { isError?: boolean }).isError).toBeFalsy();
  });

  it('SEC-63 the 31st failed token lookup from one address is a 429, and a live token from it still works', async () => {
    const ip = '203.0.113.77';
    const agent = await mintAgent((await addPerson()).id);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      statuses.push(
        (
          await mcp(randomToken(), call2025('list_projects'), {
            headers: { 'cf-connecting-ip': ip },
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 30).filter((s) => s !== 401)).toEqual([]);
    expect(statuses[30]).toBe(429);
    const live = await mcp(agent.token, call2025('list_projects'), {
      headers: { 'cf-connecting-ip': ip },
    });
    expect(live.status).toBe(200);
  });

  it('a bearer of the wrong shape is refused without counting against the address', async () => {
    const ip = '203.0.113.78';
    for (let i = 0; i < 40; i += 1) {
      const response = await mcp('short', call2025('list_projects'), {
        headers: { 'cf-connecting-ip': ip },
      });
      expect(response.status).toBe(401);
    }
  });
});
