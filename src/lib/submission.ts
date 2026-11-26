// The week's submission states and the one table of the changes between them. Any pair not in the table is the
// catalog's `bad_transition`; the route table decides who may send each event.
import { fail } from './errors';
import type { WeekState } from './week';

export type SubmissionEvent = 'submit' | 'approve' | 'return';

/** Who sends the event: the week's owner, or an approver (an accounting admin with a fresh passkey confirmation). */
export type Sender = 'owner' | 'approver';

export interface Transition {
  readonly from: WeekState;
  readonly event: SubmissionEvent;
  readonly to: WeekState;
  readonly by: Sender;
}

/** The states an approver may approve out of for an offboarded person, who can no longer submit, on their behalf. */
export const ON_BEHALF_FROM: readonly WeekState[] = ['draft', 'returned'];

export const WEEK_STATES: readonly WeekState[] = ['draft', 'submitted', 'approved', 'returned'];
export const SUBMISSION_EVENTS: readonly SubmissionEvent[] = ['submit', 'approve', 'return'];

export const TRANSITIONS: readonly Transition[] = [
  { from: 'draft', event: 'submit', to: 'submitted', by: 'owner' },
  { from: 'returned', event: 'submit', to: 'submitted', by: 'owner' },
  { from: 'submitted', event: 'approve', to: 'approved', by: 'approver' },
  { from: 'submitted', event: 'return', to: 'returned', by: 'approver' },
  { from: 'approved', event: 'return', to: 'returned', by: 'approver' },
];

/** What a person reads after the catalog's `bad_transition` words, for each pair the table refuses. */
export const REFUSED: Readonly<Record<string, string>> = {
  'draft approve': 'this week has not been submitted',
  'draft return': 'this week has not been submitted',
  'returned approve': 'this week was returned and has not been submitted again',
  'returned return': 'this week is already returned',
  'submitted submit': 'this week is already submitted',
  'approved submit': 'this week is already approved',
  'approved approve': 'this week is already approved',
};

/** The state `event` moves a week in `from` to; any pair the table does not list throws `bad_transition`. */
export function transition(from: WeekState, event: SubmissionEvent): WeekState {
  const row = TRANSITIONS.find((t) => t.from === from && t.event === event);
  return row?.to ?? fail('bad_transition', REFUSED[`${from} ${event}`]);
}

/** Who may send `event`, from the table. */
export function senderOf(event: SubmissionEvent): Sender {
  return TRANSITIONS.find((t) => t.event === event)?.by ?? fail('bad_transition', event);
}
