// The island's state and the calls that change it: the server's week, the person's unsaved drafts, and the
// serialised save. It decides nothing; every Action enforces the rules. A button that acts on the week (submit,
// copy, add, remove) goes through `settle`, which waits for the save that the click's own blur started, so the
// first click after typing is neither lost nor run against a stale week.
import { useRef, useState } from 'react';
import type { GridRow, LoadedWeek, WeekState } from '../../lib/week';
import { saveCells, saveCellsFor, type Base, type Outcome } from './api';
import { dayCapMessage, overDays } from './day-cap';
import { dirtyFields, draftKey, settled, withDrafts, type Drafts } from './drafts';
import type { Message } from './grid-messages';

export interface WeekStateInit {
  base: Base;
  own: boolean;
  personId: string;
  rows: GridRow[];
  state: WeekState;
  fingerprint: string;
  /** Cells a refused no-script post carried, shown again as unsaved edits. */
  typed: Drafts;
  problem: string | null;
}

/** What a finished call says: a fixed line, or one worked out from the week it returned and the rows before it. */
export type Done = string | ((week: LoadedWeek, before: readonly GridRow[]) => string);

export function useWeekState(init: WeekStateInit) {
  const { base, own, personId } = init;
  const [rows, setRows] = useState(init.rows);
  const [state, setState] = useState(init.state);
  const [print, setPrint] = useState(init.fingerprint);
  const [drafts, setDrafts] = useState<Drafts>(init.typed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(
    init.problem ? { kind: 'error', text: init.problem } : null,
  );
  const latest = useRef({ rows, drafts, print: init.fingerprint });
  const running = useRef(false);
  const again = useRef(false);
  const acting = useRef(false);
  const inflight = useRef<Promise<void>>(Promise.resolve());

  const apply = (result: Outcome, done?: Done): boolean => {
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.message });
      return false;
    }
    const text = typeof done === 'function' ? done(result.week, latest.current.rows) : done;
    setRows(result.week.rows);
    setState(result.week.state);
    setPrint(result.week.fingerprint);
    latest.current.print = result.week.fingerprint;
    latest.current.rows = result.week.rows;
    setMessage(text ? { kind: 'info', text } : null);
    return true;
  };

  const run = async (work: () => Promise<Outcome>, done?: Done): Promise<boolean> => {
    setBusy(true);
    try {
      return apply(await work(), done);
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    const posted = dirtyFields(latest.current.rows, latest.current.drafts);
    if (Object.keys(posted).length === 0) return;
    const over = overDays(withDrafts(latest.current.rows, latest.current.drafts))[0];
    if (over !== undefined) {
      setMessage({ kind: 'error', text: dayCapMessage(over) });
      return;
    }
    running.current = true;
    try {
      const send = own ? () => saveCells(base, posted) : () => saveCellsFor(base, personId, posted);
      if (await run(send, 'Saved')) {
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

  /** Saves the dirty cells; a call while a save runs is folded into one more save after it. */
  const flush = (): Promise<void> => {
    if (running.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = save();
    return inflight.current;
  };

  /** Saves what is typed, then runs `work` on the saved week; a refused save stops it and its message stays. */
  const settle = async (work: () => Promise<Outcome>, done?: Done): Promise<void> => {
    if (acting.current) return;
    acting.current = true;
    try {
      await flush();
      if (Object.keys(dirtyFields(latest.current.rows, latest.current.drafts)).length > 0) return;
      await run(work, done);
    } finally {
      acting.current = false;
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

  latest.current.rows = rows;
  latest.current.drafts = drafts;
  return { rows, state, print, drafts, busy, message, latest, flush, settle, edit };
}
