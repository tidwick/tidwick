// The forms behind the approver's buttons. The buttons sit in the bar beside the week total and name their form
// with the `form` attribute, so each posts its own Action as a plain form with no script, and neither is part of
// the grid's save form. Each carries the fingerprint of the week the approver read, so a decision on a week that
// has changed since is refused.
import { ON_BEHALF_FROM } from '../../lib/submission';
import type { WeekState } from '../../lib/week';

export type Decision = 'approve' | 'approveNext' | 'return';

export interface Choice {
  decision: Decision;
  label: string;
}

/**
 * What an approver may decide on a week in this state: a submitted week either way, an approved one only back,
 * and the open week of a person who has left may be approved on their behalf, as they cannot submit it.
 */
export function decisionsFor(state: WeekState, offboarded = false): Choice[] {
  if (state === 'submitted') {
    return [
      { decision: 'approve', label: 'Approve' },
      { decision: 'approveNext', label: 'Approve and open next' },
      { decision: 'return', label: 'Return to the person' },
    ];
  }
  if (state === 'approved') return [{ decision: 'return', label: 'Return to the person' }];
  return offboarded && ON_BEHALF_FROM.includes(state)
    ? [{ decision: 'approve', label: 'Approve on behalf' }]
    : [];
}

export const decisionFormId = (decision: Decision): string => `decide-${decision}`;

const TARGET: Record<Decision, string> = {
  approve: 'submission.approve',
  approveNext: 'submission.approve&next=1',
  return: 'submission.return',
};

export interface DecideFormsProps {
  path: string;
  csrf: string;
  weekStart: string;
  personId: string;
  fingerprint: string;
  choices: readonly Choice[];
}

export function DecideForms({
  path,
  csrf,
  weekStart,
  personId,
  fingerprint,
  choices,
}: DecideFormsProps) {
  return (
    <>
      {choices.map(({ decision }) => (
        <form
          key={decision}
          id={decisionFormId(decision)}
          method="post"
          action={`${path}?_action=${TARGET[decision]}`}
        >
          <input type="hidden" name="_csrf" value={csrf} />
          <input type="hidden" name="weekStart" value={weekStart} />
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="fingerprint" value={fingerprint} />
        </form>
      ))}
    </>
  );
}
