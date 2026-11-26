// The bar under the grid: Save, Submit week and Copy last week for an editable week, the unsaved flag, the
// approver's Approve and Return when the week awaits a decision, what the last save said, and the week total, which stays in view at
// the foot of the window however long the grid grows, on a phone as on a wide screen.
import { Fragment } from 'react';
import { formatHours } from '../../lib/hours';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { decisionFormId, type Choice } from './decide-forms';
import { GridMessages, type Message } from './grid-messages';
import { SubmitWeek } from './submit-week';

export interface GridActionsProps {
  path: string;
  editable: boolean;
  /** `own` weeks add Submit week and Copy last week. */
  own: boolean;
  busy: boolean;
  unsaved: boolean;
  /** The last save's outcome or refusal, said in the bar beside the controls that caused it. */
  message: Message | null;
  /** The approver's decisions this week allows, each a button for a form beside the grid; none for the owner. */
  decisions: readonly Choice[];
  weekTotal: number;
  onSubmitWeek: () => void;
  onCopyLastWeek: () => void;
}

const tall = 'max-md:h-11 max-md:px-4';

export function GridActions(props: GridActionsProps) {
  const { path, editable, own, busy, unsaved } = props;
  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {editable && (
        <>
          <Button type="submit" disabled={busy} className={tall}>
            Save
          </Button>
          {own && (
            <>
              <SubmitWeek
                action={`${path}?_action=submission.submit`}
                total={props.weekTotal}
                className={`${tall} border-control`}
                onConfirm={props.onSubmitWeek}
              />
              <Button
                type="submit"
                variant="outline"
                className={`${tall} border-control`}
                formAction={`${path}?_action=entries.copyLastWeek`}
                onClick={(event) => {
                  event.preventDefault();
                  props.onCopyLastWeek();
                }}
              >
                Copy last week
              </Button>
            </>
          )}
          <span className="text-sm text-muted-foreground">
            {unsaved ? 'Unsaved changes' : busy ? 'Saving…' : ''}
          </span>
        </>
      )}
      <GridMessages message={props.message} />
      {props.decisions.map(({ decision, label }) => (
        <Fragment key={decision}>
          {decision === 'return' && (
            <Input
              type="text"
              name="reason"
              form={decisionFormId(decision)}
              required
              maxLength={500}
              aria-label="Reason for returning"
              placeholder="Why is it returned?"
              className="h-11 basis-64 border-control md:h-9 md:max-w-sm"
            />
          )}
          <Button
            type="submit"
            form={decisionFormId(decision)}
            variant={decision === 'return' ? 'outline' : 'default'}
            className={decision === 'return' ? `${tall} border-control` : tall}
          >
            {label}
          </Button>
        </Fragment>
      ))}
      <p className="ml-auto flex items-baseline gap-2 text-sm font-medium max-md:order-first max-md:w-full max-md:justify-between">
        Week total
        <output aria-live="off" aria-label="Week total" className="text-lg tabular-nums">
          {formatHours(props.weekTotal)}
        </output>
      </p>
    </div>
  );
}
