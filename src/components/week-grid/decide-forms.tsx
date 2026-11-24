// The two forms behind the approver's Approve and Return buttons. The buttons sit in the bar beside the week
// total and name their form with the `form` attribute, so each posts its own Action as a plain form with no
// script, and neither is part of the grid's save form.
import type { WeekState } from '../../lib/week';

export type Decision = 'approve' | 'return';

/** What an approver may decide on a week in this state: a submitted week either way, an approved one only back. */
export function decisionsFor(state: WeekState): Decision[] {
  if (state === 'submitted') return ['approve', 'return'];
  return state === 'approved' ? ['return'] : [];
}

export const decisionFormId = (decision: Decision): string => `decide-${decision}`;

export interface DecideFormsProps {
  path: string;
  csrf: string;
  weekStart: string;
  personId: string;
  state: WeekState;
}

export function DecideForms({ path, csrf, weekStart, personId, state }: DecideFormsProps) {
  return (
    <>
      {decisionsFor(state).map((decision) => (
        <form
          key={decision}
          id={decisionFormId(decision)}
          method="post"
          action={`${path}?_action=submission.${decision}`}
        >
          <input type="hidden" name="_csrf" value={csrf} />
          <input type="hidden" name="weekStart" value={weekStart} />
          <input type="hidden" name="personId" value={personId} />
        </form>
      ))}
    </>
  );
}
