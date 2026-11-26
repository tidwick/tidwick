// A React component that a server page renders must accept and apply `className`, like the copied ui components.
// The week grid island: holds the server's week and the person's unsaved edits, shows live totals, saves dirty
// cells when a field loses focus, and replaces its state with the canonical week every Action returns. It
// decides nothing: the caps, the scope, the lock and removability are enforced by the Actions. With no script
// the same markup is a form posting the whole grid to `entries.save`. In `for` mode an accounting admin views
// another person's week, and edits it through the lock with `entriesFor.save` once they choose to.
import {
  isEditable,
  weekTotal,
  type GridRow,
  type LoadedWeek,
  type EmptyCause,
  type ProjectOption,
  type WeekState,
} from '../../lib/week';
import { AddRow } from './add-row';
import { addRow, copyLastWeek, removeRow, submitWeek, type Base } from './api';
import { DecideForms, decisionsFor } from './decide-forms';
import { dirtyFields, withDrafts, type Drafts } from './drafts';
import { GridActions } from './grid-actions';
import { GridNotice } from './grid-messages';
import { GridTable } from './grid-table';
import type { Done } from './use-week-state';
import { useUnsavedGuard } from './use-unsaved-guard';
import { useWeekState } from './use-week-state';

export interface WeekGridProps {
  /** The page's path, which every no-script form posts back to. */
  path: string;
  csrf: string;
  weekStart: string;
  days: string[];
  state: WeekState;
  rows: GridRow[];
  options: ProjectOption[];
  /** Why `options` is empty, when it is. */
  empty?: EmptyCause | null;
  /** The project picked in step one of add row when script is off. */
  addProjectId: string;
  /** The cells a refused no-script post carried, which the page shows again as unsaved edits. */
  typed?: Drafts;
  /** The message from a posted form that the Action refused, shown on the re-rendered page. */
  problem: string | null;
  /** `own`: the caller's week. `for`: `personId`'s week, seen by an accounting admin. */
  mode: 'own' | 'for';
  personId: string;
  /** In `for` mode, whether the admin chose to edit through the lock; the grid is read-only otherwise. */
  editing: boolean;
  /** The fingerprint of the week as drawn, which a submit or a decision carries back. */
  fingerprint: string;
  /** In `for` mode, whether the person has left, so an approver may approve their open week on their behalf. */
  offboarded?: boolean;
  /** In `own` mode, the reason an approver gave when the week was returned. */
  returnReason?: string | null;
  /** The export mapping's note limit, which a counter beside each note shows; null for none. */
  noteLimit: number | null;
}

const rowsAdded = (week: LoadedWeek, before: readonly GridRow[]): number =>
  week.rows.length - before.length;

const copied: Done = (week, before) => {
  const n = rowsAdded(week, before);
  if (n === 0) return 'Nothing to copy: last week has no rows, or they are all here already';
  return `Copied ${String(n)} ${n === 1 ? 'row' : 'rows'} from last week`;
};

const added: Done = (week, before) =>
  rowsAdded(week, before) === 0 ? 'That row is already in the week' : 'Row added';

const LOCKED: Record<WeekGridProps['mode'], Record<WeekState, string>> = {
  own: {
    draft: '',
    returned: 'This week was returned to you; edit it and submit again.',
    submitted: 'This week is submitted and locked.',
    approved: 'This week is approved and locked.',
  },
  for: {
    draft: '',
    returned: 'This week was returned to the person to edit and submit again.',
    submitted: '',
    approved: '',
  },
};

export function WeekGrid(props: WeekGridProps) {
  const { path, csrf, weekStart, days, options, personId } = props;
  const own = props.mode === 'own';
  const base: Base = { csrf, weekStart };
  const { rows, state, print, drafts, busy, message, latest, flush, settle, edit } = useWeekState({
    base,
    own,
    personId,
    rows: props.rows,
    state: props.state,
    fingerprint: props.fingerprint,
    typed: props.typed ?? {},
    problem: props.problem,
  });
  const editable = own ? isEditable(state) : props.editing;

  const returned = own && state === 'returned' && props.returnReason ? props.returnReason : null;
  const notice =
    !own && editable
      ? 'Editing through the lock; every change is audited.'
      : returned !== null
        ? `This week was returned to you: \u201c${returned}\u201d Edit it and submit again.`
        : LOCKED[props.mode][state];
  const choices = own ? [] : decisionsFor(state, props.offboarded);
  const shown = withDrafts(rows, drafts);
  const unsaved = Object.keys(dirtyFields(rows, drafts)).length > 0;
  useUnsavedGuard(unsaved);
  return (
    <div className="grid gap-4">
      <GridNotice notice={notice} />
      <form
        method="post"
        action={`${path}?_action=${own ? 'entries.save' : 'entriesFor.save'}`}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void flush();
        }}
      >
        <input type="hidden" name="_csrf" value={csrf} />
        <input type="hidden" name="weekStart" value={weekStart} />
        <input type="hidden" name="fingerprint" value={print} />
        {!own && <input type="hidden" name="personId" value={personId} />}
        <GridTable
          rows={rows}
          shown={shown}
          drafts={drafts}
          days={days}
          readOnly={!editable}
          path={path}
          notesOpen={!own}
          noteLimit={props.noteLimit}
          onEdit={edit}
          onLeave={() => void flush()}
          onRemove={
            own ? (rowId) => void settle(() => removeRow(base, rowId), 'Row removed') : undefined
          }
        />
        <GridActions
          path={path}
          editable={editable}
          own={own}
          busy={busy}
          unsaved={unsaved}
          message={message}
          decisions={choices}
          weekTotal={weekTotal(shown)}
          onSubmitWeek={() =>
            void settle(
              () => submitWeek(base, latest.current.print),
              'Submitted; the week is locked',
            )
          }
          onCopyLastWeek={() => void settle(() => copyLastWeek(base), copied)}
        />
      </form>
      {!own && (
        <DecideForms
          path={path}
          csrf={csrf}
          weekStart={weekStart}
          personId={personId}
          fingerprint={print}
          choices={choices}
        />
      )}
      {editable && own && (
        <AddRow
          options={options}
          empty={props.empty}
          path={path}
          csrf={csrf}
          weekStart={weekStart}
          initialProjectId={props.addProjectId}
          onAdd={(projectId, taskCodeId) =>
            void settle(() => addRow(base, projectId, taskCodeId), added)
          }
        />
      )}
    </div>
  );
}
