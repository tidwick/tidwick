// One test per policy knob that governs a sign-in, token or link: the configured number, not the default, decides.
// The Action and page wiring from the real variable is held by the app project (its vars are set off the defaults).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  adminScope,
  DAY,
  deps,
  enrolledPerson,
  HOUR,
  MINUTE,
  T0,
  withSession,
} from '../../test/helpers/auth';
import { memberScope } from '../../test/helpers/reference';
import { openEnrolment } from '../db/enrolments';
import { pendingCodesOf } from '../db/pending-codes';
import { AppError } from '../lib/errors';
import { DEFAULT_POLICY, readPolicy } from '../lib/policy';
import { grantAccess } from '../oauth/grant';
import { mintPersonalToken } from './agent-personal';
import { regenerateCodes } from './recovery-codes';
import { reenrol } from './revoke';
import { issueEnrolment } from './enrol';
import { newSession, readSession } from './session';
import { requireStepUp } from './step-up';
import { keyedHash } from './tokens';

const refusedWith = async (run: () => Promise<unknown>, code: string): Promise<void> => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected ${code}`);
};

const NOW = Date.UTC(2026, 5, 1);
const input = (days: number) => ({ label: 'Laptop', scopes: ['read'] as const, days });

describe('agent token knobs', () => {
  it('AGENT_TOKEN_MAX: a person holds the configured number of live tokens, no more, through a token or an approval', async () => {
    const policy = readPolicy({ AGENT_TOKEN_MAX: '2' });
    const { id, scope } = await memberScope();
    await withSession(id, NOW);
    const secret = deps().secret;
    await mintPersonalToken(scope, env.DB, secret, id, input(30), policy, NOW);
    await mintPersonalToken(scope, env.DB, secret, id, input(30), policy, NOW + 1);
    await refusedWith(
      () => mintPersonalToken(scope, env.DB, secret, id, input(30), policy, NOW + 2),
      'agent_limit',
    );
    const request = {
      client: { id: 'https://client.example/meta.json', name: 'Example Agent', redirectUris: [] },
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      state: null,
      challenge: 'c'.repeat(43),
      offered: ['read'],
    } as const;
    await refusedWith(
      () =>
        grantAccess(scope, env.DB, secret, id, request, ['read'], policy.agentTokenMax, NOW + 3),
      'agent_limit',
    );
    await grantAccess(
      scope,
      env.DB,
      secret,
      id,
      request,
      ['read'],
      DEFAULT_POLICY.agentTokenMax,
      NOW + 4,
    );
  });

  it('AGENT_TOKEN_DAYS: only the configured lives are offered, and the grant ends that many days out', async () => {
    const policy = readPolicy({ AGENT_TOKEN_DAYS: '14,365' });
    const { id, scope } = await memberScope();
    await withSession(id, NOW);
    const secret = deps().secret;
    await refusedWith(
      () => mintPersonalToken(scope, env.DB, secret, id, input(30), policy, NOW),
      'invalid_input',
    );
    const minted = await mintPersonalToken(scope, env.DB, secret, id, input(365), policy, NOW);
    expect(minted.expiresAt).toBe(NOW + 365 * DAY);
  });
});

describe('session knobs', () => {
  it('SESSION_IDLE_HOURS: a session idle that long ends, one hour sooner it does not', async () => {
    const idleMs = readPolicy({ SESSION_IDLE_HOURS: '2' }).sessionIdleMs;
    const d = deps();
    const person = await enrolledPerson();
    expect(
      await readSession(d.db, d.secret, person.sessionId, T0 + 2 * HOUR - 1, idleMs),
    ).not.toBeNull();
    const other = await enrolledPerson();
    expect(await readSession(d.db, d.secret, other.sessionId, T0 + 2 * HOUR, idleMs)).toBeNull();
    const third = await enrolledPerson();
    expect(
      await readSession(
        d.db,
        d.secret,
        third.sessionId,
        T0 + 2 * HOUR,
        DEFAULT_POLICY.sessionIdleMs,
      ),
    ).not.toBeNull();
  });

  it('SESSION_MAX_DAYS: a new session ends that many days after it opened, however active', async () => {
    const maxMs = readPolicy({ SESSION_MAX_DAYS: '3' }).sessionMaxMs;
    const d = deps();
    const person = await enrolledPerson();
    const { rawId, statement } = await newSession(d.db, d.secret, person.personId, T0, maxMs);
    await statement.run();
    const live = (at: number) => readSession(d.db, d.secret, rawId, at, 4 * DAY);
    expect(await live(T0 + 3 * DAY - 1)).not.toBeNull();
    expect(await live(T0 + 3 * DAY)).toBeNull();
  });

  it('STEP_UP_MINUTES: a confirmation older than the configured minutes is refused, one a minute younger passes', () => {
    const stepUpMs = readPolicy({ STEP_UP_MINUTES: '5' }).stepUpMs;
    const session = { rawId: 'x', personId: 'p', name: 'n', mustEnrol: false, stepUpAt: T0 };
    const check = (at: number, maxMs: number) => () => {
      requireStepUp(session, at, maxMs);
    };
    expect(check(T0 + 5 * MINUTE - 1, stepUpMs)).not.toThrow();
    expect(check(T0 + 5 * MINUTE, stepUpMs)).toThrow(AppError);
    expect(check(T0 + 5 * MINUTE, DEFAULT_POLICY.stepUpMs)).not.toThrow();
  });
});

describe('link and code knobs', () => {
  it('ENROLMENT_HOURS: an issued link, and a re-enrolment link, stay open that long and no longer', async () => {
    const lifeMs = readPolicy({ ENROLMENT_HOURS: '2' }).enrolmentMs;
    const d = deps();
    const person = await enrolledPerson();
    const token = await issueEnrolment(
      await adminScope(),
      d.db,
      d.secret,
      person.personId,
      T0,
      lifeMs,
    );
    const hash = await keyedHash(d.secret, 'enrol', token);
    expect(await openEnrolment(d.db, hash, T0 + 2 * HOUR - 1)).not.toBeNull();
    expect(await openEnrolment(d.db, hash, T0 + 2 * HOUR)).toBeNull();
    const again = await reenrol(
      await adminScope(),
      d.db,
      d.secret,
      (await enrolledPerson()).personId,
      T0,
      lifeMs,
    );
    const againHash = await keyedHash(d.secret, 'enrol', again);
    expect(await openEnrolment(d.db, againHash, T0 + 2 * HOUR)).toBeNull();
  });

  it('PENDING_CODES_MINUTES: new recovery codes can be re-read for that many minutes, then they are erased', async () => {
    const lifeMs = readPolicy({ PENDING_CODES_MINUTES: '2' }).pendingCodesMs;
    const d = deps();
    const person = await enrolledPerson();
    const owner = { personId: person.personId, rawId: 'raw-session' };
    const codes = await regenerateCodes(
      await adminScope(),
      d.db,
      d.secret,
      person.personId,
      T0,
      owner.rawId,
      lifeMs,
    );
    expect(await pendingCodesOf(d.db, d.secret, owner, T0 + 2 * MINUTE - 1)).toEqual(codes);
    expect(await pendingCodesOf(d.db, d.secret, owner, T0 + 2 * MINUTE)).toEqual([]);
  });
});
