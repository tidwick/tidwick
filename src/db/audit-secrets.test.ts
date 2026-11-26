// The logging probe for the audit log: the writes that handle a token, a code, a session or a note are run for
// real, and no audit row may hold any of them in the clear.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, adminScope, deps, enrolledPerson, MINUTE, T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { issueEnrolment } from '../auth/enrol';
import { recover } from '../auth/recovery';
import { regenerateCodes } from '../auth/recovery-codes';
import { currentEnv, noteKeks } from '../lib/env';
import { saveCellsFor } from './entries-for';
import { scopeFor } from './scope';

describe('no secret reaches the audit log', () => {
  it('enrolment, recovery, new codes and a note edited through the lock leave no token, code, session id, note text or key in any event', async () => {
    const d = deps();
    const { NOTE_KEK, SESSION_SECRET } = currentEnv();
    const from = await headSeq();
    const person = await enrolledPerson();
    const other = await addPerson();
    const token = await issueEnrolment(await adminScope(), d.db, d.secret, other.id, T0);
    const code = person.codes[0] ?? '';
    const recovered = await recover(d, person.email, code, T0 + MINUTE);
    const scope = await scopeFor(env.DB, person.personId);
    const fresh = await regenerateCodes(
      scope,
      d.db,
      d.secret,
      person.personId,
      T0 + 2 * MINUTE,
      'sess',
    );
    const week = await bookedWeek();
    const note = `audit probe note ${crypto.randomUUID()}`;
    const edit = { rowId: week.rowId, dow: 1, hundredths: 150, note };
    await saveCellsFor(week.admin, env.DB, noteKeks(), week.who.personId, WEEK, [edit], T0);

    const events = await eventsAfter(from);
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'auth.enrol',
        'people.issueEnrolment',
        'auth.recover',
        'auth.regenerateCodes',
        'entriesFor.save',
      ]),
    );
    const sealed = events.find((e) => e.action === 'entriesFor.save')?.after_json ?? '';
    expect(JSON.parse(sealed)).toMatchObject({ note_ct: expect.any(String) as unknown });
    const text = JSON.stringify(events);
    const held = {
      token,
      sessions: [person.sessionId, recovered.sessionId, week.who.raw],
      csrf: week.who.token,
      codes: [...person.codes, ...fresh],
      note,
      NOTE_KEK,
      SESSION_SECRET,
    };
    for (const [kind, values] of Object.entries(held)) {
      for (const value of [values].flat()) {
        expect(value.length, kind).toBeGreaterThan(8);
        expect(text, kind).not.toContain(value);
      }
    }
  });
});
