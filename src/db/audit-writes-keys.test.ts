// The note keys moved by `keys.rewrap`: one audit event per key, naming the client and the two KEKs by id, and
// never the wrapped key or the data key, so erasing a client's key later leaves nothing in the log to unwrap.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { eventsAfter, headSeq, unique } from '../../test/helpers/reference';
import { currentEnv } from '../lib/env';
import { kekId } from '../lib/note-crypto';
import { createClient } from './clients';
import { rewrapKeys } from './key-rewrap';

const WRAPPED = 'SELECT lower(hex(wrapped)) AS h FROM client_key WHERE wrapped IS NOT NULL';

async function keyHexes(): Promise<string[]> {
  return (await env.DB.prepare(WRAPPED).all<{ h: string }>()).results.map((row) => row.h);
}

describe('the note key rewrap', () => {
  it("'keys.rewrap' adds one event per key it moved, with the KEK ids before and after and no key bytes", async () => {
    const scope = await adminScope();
    const old = currentEnv().NOTE_KEK;
    const ids = [];
    for (const name of [unique('Kiln'), unique('Quarry')]) {
      ids.push((await createClient(scope, env.DB, old, name, T0)).id);
    }
    const before = await keyHexes();
    const next = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    const head = await headSeq();
    const run = await rewrapKeys(scope, env.DB, { current: next, previous: old }, T0 + 1);
    expect(run.rewrapped).toBe(ids.length);
    const events = await eventsAfter(head);
    const moved = [
      JSON.stringify({ kek_id: await kekId(old) }),
      JSON.stringify({ kek_id: await kekId(next) }),
    ];
    expect(
      events.map((e) => [e.action, e.target, e.actor_id, e.client_id, e.before_json, e.after_json]),
    ).toEqual(
      ids
        .toSorted()
        .map((id) => ['keys.rewrap', `client_key:${id}:1`, scope.actorId, id, ...moved]),
    );
    const logged = JSON.stringify(events);
    for (const bytes of [...before, ...(await keyHexes())])
      expect(logged).not.toContain(bytes.slice(0, 16));

    const again = await headSeq();
    expect(
      (await rewrapKeys(scope, env.DB, { current: next, previous: old }, T0 + 2)).rewrapped,
    ).toBe(0);
    expect(await headSeq()).toBe(again);
  });
});
