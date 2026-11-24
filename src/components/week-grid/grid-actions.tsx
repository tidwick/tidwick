// The bar under the grid: Save, Submit week and Copy last week for an editable week, the unsaved flag, the
// approver's Approve and Return when the week awaits a decision, what the last save said, and the week total, which stays in view at
// the foot of the window however long the grid grows, on a phone as on a wide screen.
import { formatHours } from '../../lib/hours';
import { Button } from '../ui/button';
import { decisionFormId, type Decision } from './decide-forms';
import { GridMessages, type Message } from './grid-messages';

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
  decisions: Decision[];
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
              <Button
                type="submit"
                variant="outline"
                className={`${tall} border-control`}
                formAction={`${path}?_action=submission.submit`}
                disabled={busy || unsaved}
                onClick={(event) => {
                  event.preventDefault();
                  props.onSubmitWeek();
                }}
              >
                Submit week
              </Button>
              <Button
                type="submit"
                variant="outline"
                className={`${tall} border-control`}
                formAction={`${path}?_action=entries.copyLastWeek`}
                disabled={busy}
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
      {props.decisions.map((decision) => (
        <Button
          key={decision}
          type="submit"
          form={decisionFormId(decision)}
          variant={decision === 'approve' ? 'default' : 'outline'}
          className={decision === 'approve' ? tall : `${tall} border-control`}
        >
          {decision === 'approve' ? 'Approve' : 'Return to the person'}
        </Button>
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
