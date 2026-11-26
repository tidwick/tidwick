// A React component that a server page renders must accept and apply `className`, like the copied ui components.
// The week grid island: holds the server's week and the person's unsaved edits, shows live totals, saves dirty
// cells when a field loses focus, and replaces its state with the canonical week every Action returns. It
// decides nothing: the caps, the scope, the lock and removability are enforced by the Actions. With no script
// the same markup is a form posting the whole grid to `entries.save`. In `for` mode an accounting admin views
// another person's week, and edits it through the lock with `entriesFor.save` once they choose to.
import { useRef, useState } from 'react';
import {
  isEditable,
  weekTotal,
  type GridRow,
  type EmptyCause,
  type ProjectOption,
  type WeekState,
} from '../../lib/week';
import { AddRow } from './add-row';
import {
  addRow,
  copyLastWeek,
  removeRow,
  saveCells,
  saveCellsFor,
  submitWeek,
  type Base,
  type Outcome,
} from './api';
import { DecideForms, decisionsFor } from './decide-forms';
import { dayCapMessage, overDays } from './day-cap';
import { dirtyFields, draftKey, settled, withDrafts, type Drafts } from './drafts';
import { GridActions } from './grid-actions';
import { GridNotice, type Message } from './grid-messages';
import { GridTable } from './grid-table';
import { useUnsavedGuard } from './use-unsaved-guard';

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
  const [rows, setRows] = useState(props.rows);
  const [state, setState] = useState(props.state);
  const [print, setPrint] = useState(props.fingerprint);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(
    props.problem ? { kind: 'error', text: props.problem } : null,
  );
  const latest = useRef({ rows, drafts });
  const running = useRef(false);
  const again = useRef(false);
  latest.current = { rows, drafts };
  const editable = own ? isEditable(state) : props.editing;

  const apply = (result: Outcome, done?: string): boolean => {
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return false;
    }
    setRows(result.week.rows);
    setState(result.week.state);
    setPrint(result.week.fingerprint);
    latest.current.rows = result.week.rows;
    setMessage(done ? { kind: 'info', text: done } : null);
    return true;
  };

  const run = async (work: () => Promise<Outcome>, done?: string): Promise<boolean> => {
    setBusy(true);
    try {
      return apply(await work(), done);
    } finally {
      setBusy(false);
    }
  };

  const flush = async (): Promise<void> => {
    if (running.current) {
      again.current = true;
      return;
    }
    const posted = dirtyFields(latest.current.rows, latest.current.drafts);
    if (Object.keys(posted).length === 0) return;
    const over = overDays(withDrafts(latest.current.rows, latest.current.drafts))[0];
    if (over !== undefined) {
      setMessage({ kind: 'error', text: dayCapMessage(over) });
      return;
    }
    running.current = true;
    try {
      const save = own ? () => saveCells(base, posted) : () => saveCellsFor(base, personId, posted);
      const saved = await run(save, 'Saved');
      if (saved) {
        const left = settled(latest.current.drafts, posted);
        latest.current.drafts = left;
        setDrafts(left);
      }
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        await flush();
      }
    }
  };

  const edit = (rowId: string, dow: number, part: 'hours' | 'note', value: string): void => {
    const key = draftKey(rowId, dow);
    const next = {
      ...latest.current.drafts,
      [key]: { ...latest.current.drafts[key], [part]: value },
    };
    latest.current.drafts = next;
    setDrafts(next);
    setMessage(null);
  };

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
            own ? (rowId) => void run(() => removeRow(base, rowId), 'Row removed') : undefined
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
            void run(() => submitWeek(base, print), 'Submitted; the week is locked')
          }
          onCopyLastWeek={() => void run(() => copyLastWeek(base), 'Copied last week\u2019s rows')}
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
          busy={busy}
          onAdd={(projectId, taskCodeId) =>
            void run(() => addRow(base, projectId, taskCodeId), 'Row added')
          }
        />
      )}
    </div>
  );
}
