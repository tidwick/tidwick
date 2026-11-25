// SEC-11: the role-by-action matrix for the admin data Actions, written from the requirements (an admin owns
// reference data and people; accounting admins and admins manage assignments; any member creates clients and
// projects; any member submits their own week; an accounting admin approves, returns and edits a week through the
// lock; granting and removing power, handing out access, the settings, re-wrapping the note keys and those week
// decisions need a fresh passkey confirmation), not read from src/routes.ts, so a drift in either shows as a diff.
// Runs through the built Worker, by both callers.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MINUTE, ACCOUNTING, ADMIN } from '../../../test/helpers/auth';
import { caller, formPost, rpcForm, type Caller, type Fields } from '../../../test/helpers/callers';
import { grantsOf } from '../../db/roles';
import { offboardOtherAdmins } from '../../db/test-support';

type Cell = 'allow' | '401' | '403';
const OK: Cell = 'allow';
const OUT: Cell = '401';
const NO: Cell = '403';

/** The actors, in column order of the matrix below. */
const ACTORS = [
  'signed out',
  'member',
  'accounting admin',
  'an admin',
  'admin and accounting admin',
  'recovery session',
  'admin with a stale passkey confirmation',
] as const;

const MATRIX: Readonly<Record<string, readonly Cell[]>> = {
  //                         out  member acct  admin both  recov stale
  'clients.create': [OUT, OK, OK, OK, OK, NO, OK],
  'projects.create': [OUT, OK, OK, OK, OK, NO, OK],
  'clients.update': [OUT, NO, NO, OK, OK, NO, OK],
  'clients.archive': [OUT, NO, NO, OK, OK, NO, OK],
  'projects.update': [OUT, NO, NO, OK, OK, NO, OK],
  'projects.archive': [OUT, NO, NO, OK, OK, NO, OK],
  'projects.setTasks': [OUT, NO, NO, OK, OK, NO, OK],
  'taskCodes.create': [OUT, NO, NO, OK, OK, NO, OK],
  'taskCodes.update': [OUT, NO, NO, OK, OK, NO, OK],
  'taskCodes.archive': [OUT, NO, NO, OK, OK, NO, OK],
  'people.create': [OUT, NO, NO, OK, OK, NO, OK],
  'assignments.add': [OUT, NO, OK, OK, OK, NO, OK],
  'assignments.remove': [OUT, NO, OK, OK, OK, NO, OK],
  'assignments.addAll': [OUT, NO, OK, OK, OK, NO, OK],
  'people.issueEnrolment': [OUT, NO, NO, OK, OK, NO, NO],
  'people.reenrol': [OUT, NO, NO, OK, OK, NO, NO],
  'people.unlock': [OUT, NO, NO, OK, OK, NO, NO],
  'people.unlinkSso': [OUT, NO, NO, OK, OK, NO, NO],
  'people.setRoles': [OUT, NO, NO, OK, OK, NO, NO],
  'people.offboard': [OUT, NO, NO, OK, OK, NO, NO],
  'submission.submit': [OUT, OK, OK, OK, OK, NO, OK],
  'submission.approve': [OUT, NO, OK, NO, OK, NO, NO],
  'submission.return': [OUT, NO, OK, NO, OK, NO, NO],
  'entriesFor.save': [OUT, NO, OK, NO, OK, NO, NO],
  'import.preview': [OUT, NO, OK, NO, OK, NO, NO],
  'import.apply': [OUT, NO, OK, NO, OK, NO, NO],
  'settings.saveCsv': [OUT, NO, OK, NO, OK, NO, NO],
  'settings.save': [OUT, NO, NO, OK, OK, NO, NO],
  'keys.rewrap': [OUT, NO, NO, OK, OK, NO, NO],
  'audit.verify': [OUT, NO, OK, OK, OK, NO, OK],
};

const ACTION_FILES = Object.keys(import.meta.glob(['../*/*.ts', '!../*/*.test.ts']))
  .map((file) => file.replace(/^\.\.\/([^/]+)\/([^/]+)\.ts$/, '$1.$2'))
  // The setup claim is public and guarded by its token and an empty database: SEC-48.
  .filter(
    (name) =>
      !name.startsWith('auth.') && !name.startsWith('entries.') && !name.startsWith('setup.'),
  );

async function actor(index: number): Promise<Caller | null> {
  switch (index) {
    case 0:
      return null;
    case 1:
      return caller([]);
    case 2:
      return caller([ACCOUNTING]);
    case 3:
      return caller([ADMIN]);
    case 4:
      return caller([ADMIN, ACCOUNTING]);
    case 5:
      return caller([ADMIN], { mustEnrol: true });
    default:
      return caller([ADMIN], { stepUpAgo: 20 * MINUTE });
  }
}

/** What the route table did with a request: 401, 403 for a denial by role, recovery or step-up, else it let it through. */
async function outcome(response: Response): Promise<Cell> {
  if (response.status === 401) return OUT;
  if (response.status !== 403) return OK;
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('application/json')) return NO;
  const body = await response.json<{ error?: string }>();
  return body.error === 'forbidden' || body.error === 'step_up_required' ? NO : OK;
}

describe('SEC-11 the role-by-action matrix', () => {
  it('SEC-11 the matrix names every admin data Action and no other', () => {
    expect(Object.keys(MATRIX).toSorted()).toEqual(ACTION_FILES.toSorted());
    for (const row of Object.values(MATRIX)) expect(row).toHaveLength(ACTORS.length);
  });

  it('SEC-11 every actor gets the committed outcome on every Action, by the script and the no-script caller', async () => {
    const wrong: string[] = [];
    for (const [index, label] of ACTORS.entries()) {
      const who = await actor(index);
      for (const [name, row] of Object.entries(MATRIX)) {
        const expected = row[index];
        const script = await outcome(await rpcForm(name, who));
        const form = await outcome(await formPost('/account', name, who));
        if (script !== expected)
          wrong.push(`${name} as ${label}, script: ${script}, expected ${String(expected)}`);
        if (form !== expected)
          wrong.push(`${name} as ${label}, form: ${form}, expected ${String(expected)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

async function grants(personId: string) {
  return grantsOf(env.DB, personId);
}

describe('SEC-11 privilege cannot be raised by the wrong person', () => {
  it('SEC-11 a member and an accounting admin cannot grant themselves admin, and nothing changes', async () => {
    for (const held of [[], [ACCOUNTING]] as const) {
      const who = await caller(held);
      const before = await grants(who.personId);
      const fields: Fields = { id: who.personId, grants: [ADMIN, ACCOUNTING] };
      expect((await rpcForm('people.setRoles', who, fields)).status).toBe(403);
      expect((await formPost('/account', 'people.setRoles', who, fields)).status).toBe(403);
      expect(await grants(who.personId)).toEqual(before);
    }
  });

  it('SEC-11 an admin grants and revokes roles only with a fresh passkey confirmation', async () => {
    const target = await caller([]);
    const stale = await caller([ADMIN], { stepUpAgo: 16 * MINUTE });
    const fields: Fields = { id: target.personId, grants: [ACCOUNTING] };
    const refused = await rpcForm('people.setRoles', stale, fields);
    expect(refused.status).toBe(403);
    expect((await refused.json<{ error: string }>()).error).toBe('step_up_required');
    expect(await grants(target.personId)).toEqual([]);

    const fresh = await caller([ADMIN]);
    expect((await rpcForm('people.setRoles', fresh, fields)).status).toBe(200);
    expect(await grants(target.personId)).toEqual([ACCOUNTING]);
    expect((await rpcForm('people.setRoles', fresh, { id: target.personId })).status).toBe(200);
    expect(await grants(target.personId)).toEqual([]);
  });

  it('SEC-11 the last admin stays: the Actions refuse to remove or offboard the only active admin', async () => {
    const only = await caller([ADMIN]);
    await offboardOtherAdmins(env.DB, only.personId);
    for (const [name, fields] of [
      ['people.setRoles', { id: only.personId }],
      ['people.offboard', { id: only.personId }],
    ] as const) {
      const response = await rpcForm(name, only, fields);
      expect(response.status, name).toBe(409);
      expect((await response.json<{ code: string }>()).code, name).toBe('CONFLICT');
    }
    expect(await grants(only.personId)).toEqual([ADMIN]);
  });
});
