// Through the built Worker, from one address: the two login Actions count against the larger login bucket and
// recovery against the strict one, so moving any of them to the other bucket fails here (ADR 0003).
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { deps, enrolledPerson } from '../../../test/helpers/auth';
import { ORIGIN } from '../../../test/helpers/callers';
import { loginOptions } from '../../auth/login';

/** A signed-out POST to `/_actions/<name>` from `ip`, as a script sends it. */
function post(name: string, ip: string, type: string, body: string): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': type, 'cf-connecting-ip': ip },
      body,
    }),
  );
}

const json = (name: string, ip: string, body: object = {}) =>
  post(name, ip, 'application/json', JSON.stringify(body));

const recover = (ip: string) =>
  post(
    'auth.recover',
    ip,
    'application/x-www-form-urlencoded',
    new URLSearchParams({ email: 'nobody@example.test', code: 'AAAA-AAAA-AAAA-AAAA' }).toString(),
  );

describe('SEC-37 each public auth Action counts against its own bucket', () => {
  it('SEC-37 one address makes 100 login starts and 100 login finishes, none refused, and its 31st recovery is refused', async () => {
    const ip = '203.0.113.21';
    const person = await enrolledPerson();
    const d = deps();
    const { options } = await loginOptions(d, Date.now());
    const response = await person.authenticator.assert(options, d.rp.origin);

    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) statuses.push((await json('auth.loginOptions', ip)).status);
    for (let i = 0; i < 100; i++)
      statuses.push((await json('auth.loginVerify', ip, { response })).status);
    expect(statuses.filter((s) => s === 429)).toEqual([]);
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);

    const recoveries: number[] = [];
    for (let i = 0; i < 31; i++) recoveries.push((await recover(ip)).status);
    expect(recoveries.slice(0, 30).filter((s) => s === 429)).toEqual([]);
    expect(recoveries[30]).toBe(429);
  });
});
