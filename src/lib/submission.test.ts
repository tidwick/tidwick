// The submission state table, written out here from the requirements rather than read from the module, so a change
// to either shows as a failure: every pair of state and event either lands on its state or throws the catalog error.
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../routes';
import { isAppError } from './errors';
import {
  REFUSED,
  senderOf,
  SUBMISSION_EVENTS,
  transition,
  TRANSITIONS,
  WEEK_STATES,
  type SubmissionEvent,
} from './submission';
import { isEditable, type WeekState } from './week';

const ALLOWED: Readonly<Record<string, WeekState>> = {
  'draft submit': 'submitted',
  'returned submit': 'submitted',
  'submitted approve': 'approved',
  'submitted return': 'returned',
  'approved return': 'returned',
};

describe('the submission state table', () => {
  it('lists every state and event, and each allowed pair once', () => {
    expect([...WEEK_STATES].toSorted()).toEqual(['approved', 'draft', 'returned', 'submitted']);
    expect([...SUBMISSION_EVENTS].toSorted()).toEqual(['approve', 'return', 'submit']);
    const pairs = TRANSITIONS.map((t) => `${t.from} ${t.event}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.toSorted()).toEqual(Object.keys(ALLOWED).toSorted());
  });

  it('every allowed pair lands on its state and every other pair throws bad_transition', () => {
    let refused = 0;
    for (const from of WEEK_STATES) {
      for (const event of SUBMISSION_EVENTS) {
        const expected = ALLOWED[`${from} ${event}`];
        if (expected !== undefined) {
          expect(transition(from, event), `${from} ${event}`).toBe(expected);
          continue;
        }
        let thrown: unknown = null;
        try {
          transition(from, event);
        } catch (error) {
          thrown = error;
        }
        expect(isAppError(thrown, 'bad_transition'), `${from} ${event}`).toBe(true);
        refused += 1;
      }
    }
    expect(refused).toBe(WEEK_STATES.length * SUBMISSION_EVENTS.length - 5);
  });

  it("a refused pair says in a sentence what state the week is in, never the table's own words", () => {
    const said: Record<string, string> = {
      'draft approve': 'this week has not been submitted',
      'draft return': 'this week has not been submitted',
      'approved approve': 'this week is already approved',
      'approved submit': 'this week is already approved',
      'submitted submit': 'this week is already submitted',
      'returned approve': 'this week was returned and has not been submitted again',
      'returned return': 'this week is already returned',
    };
    for (const [pair, sentence] of Object.entries(said)) {
      const [from, event] = pair.split(' ') as [WeekState, SubmissionEvent];
      expect(() => transition(from, event), pair).toThrow(
        `That change of state is not allowed: ${sentence}`,
      );
    }
    expect(Object.keys(REFUSED).toSorted()).toEqual(Object.keys(said).toSorted());
  });

  it('a week is locked to its owner exactly in the states a submit leaves or an approve reaches', () => {
    const locked = WEEK_STATES.filter((s) => !isEditable(s)).toSorted();
    expect(locked).toEqual(['approved', 'submitted']);
  });

  it('the owner submits without step-up; approve and return are accounting admin Actions with step-up', () => {
    const expected: Record<SubmissionEvent, 'owner' | 'approver'> = {
      submit: 'owner',
      approve: 'approver',
      return: 'approver',
    };
    for (const event of SUBMISSION_EVENTS) {
      expect(senderOf(event), event).toBe(expected[event]);
      const rule = ACTIONS[`submission.${event}`];
      expect(rule?.stepUp, event).toBe(senderOf(event) === 'approver');
      expect(rule?.roles.includes('member'), event).toBe(senderOf(event) === 'owner');
    }
  });
});
