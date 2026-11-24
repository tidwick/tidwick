// The grid itself: a header of the seven days, a line per row, and the day totals. Totals come from
// `lib/week.ts`, the same integer sums the server uses; a day over the cap marks its header, its cells and
// says why under the totals, in the catalog's words. The keys move focus between fields here, and each row's
// ledger opens here: on Enter in its hours, from its own toggle, or with "Open all notes", a checkbox that also
// opens every ledger through the stylesheet alone when script is off.
import { TriangleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatHours } from '../../lib/hours';
import { dayLabel, dayTotals, DAYS_IN_WEEK, weekTotal, type GridRow } from '../../lib/week';
import { afterNote, focusCell, landing, type Move } from './cell-keys';
import { dayCapMessage, overDays } from './day-cap';
import type { Drafts } from './drafts';
import { dayLine, GridRowView, lineGrid, sticky } from './grid-row';
import type { NoteKey } from './note-line';

export interface GridTableProps {
  /** Rows as the server holds them. */
  rows: readonly GridRow[];
  /** The same rows with unsaved edits applied, for the totals and the remove hint. */
  shown: readonly GridRow[];
  drafts: Drafts;
  days: readonly string[];
  readOnly: boolean;
  path: string;
  /** Whether every row's ledger starts open, as on the approver's view. */
  notesOpen: boolean;
  noteLimit: number | null;
  onEdit: (rowId: string, dow: number, part: 'hours' | 'note', value: string) => void;
  onLeave: () => void;
  /** Absent when rows cannot be removed here, as when editing another person's week through the lock. */
  onRemove?: ((rowId: string) => void) | undefined;
}

export function GridTable(props: GridTableProps) {
  const { rows, shown, days, readOnly } = props;
  const body = useRef<HTMLTableSectionElement>(null);
  const ids = useId();
  const capIds = days.map((_, dow) => `${ids}-cap-${String(dow)}`);
  const over = overDays(shown);
  const isOver = days.map((_, dow) => over.includes(dow));
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>(() =>
    Object.fromEntries(rows.map((row) => [row.rowId, props.notesOpen])),
  );
  const isOpen = (rowId: string): boolean => open[rowId] ?? props.notesOpen;
  const allOpen = rows.length > 0 && rows.every((row) => isOpen(row.rowId));
  const toggle = (rowId: string, next: boolean): void => {
    setOpen((now) => (now[rowId] === next ? now : { ...now, [rowId]: next }));
  };
  const move = (row: number, dow: number, direction: Move): void => {
    const to = landing(direction, row, dow, rows.length, days.length);
    if (body.current) focusCell(body.current, to.row, to.dow);
  };
  const openNote = (row: number, dow: number): void => {
    const rowId = rows[row]?.rowId;
    if (rowId === undefined || !body.current) return;
    flushSync(() => {
      toggle(rowId, true);
    });
    focusCell(body.current, row, dow, 'note');
  };
  const noteKey = (row: number, dow: number, key: NoteKey): void => {
    const to = key === 'back' ? { row, dow } : afterNote(row, dow, rows.length, days.length);
    if (body.current) focusCell(body.current, to.row, to.dow);
  };
  return (
    <div className="group/notes grid gap-2">
      <label className="flex w-fit items-center gap-2 text-sm max-md:min-h-11">
        <input
          type="checkbox"
          checked={allOpen}
          className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onChange={(event) => {
            const next = event.target.checked;
            setOpen(Object.fromEntries(rows.map((row) => [row.rowId, next])));
          }}
        />
        Open all notes
      </label>
      <div className="md:overflow-x-auto md:rounded-md md:border md:border-border">
        <table
          role="table"
          aria-label="Hours by project, task and day"
          className="block w-full text-sm md:min-w-[52rem]"
        >
          <thead role="rowgroup" className="max-md:sr-only md:block">
            <tr role="row" className={`border-b border-border text-muted-foreground ${lineGrid}`}>
              <th
                scope="col"
                role="columnheader"
                className={`${sticky} min-w-40 px-3 py-2 font-medium`}
              >
                Project and task
              </th>
              {days.map((date, dow) => (
                <th
                  key={date}
                  scope="col"
                  role="columnheader"
                  data-over={isOver[dow]}
                  className="px-2 py-2 text-right font-medium whitespace-nowrap data-[over=true]:bg-danger-surface data-[over=true]:text-danger"
                >
                  {isOver[dow] && (
                    <TriangleAlert
                      aria-hidden="true"
                      className="mr-1 inline size-3.5 align-text-bottom"
                    />
                  )}
                  {dayLabel(date, dow)}
                </th>
              ))}
              <th scope="col" role="columnheader" className="px-3 py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody ref={body} role="rowgroup" className="max-md:grid max-md:gap-2 md:block">
            {rows.length === 0 && (
              <tr role="row">
                <td
                  role="cell"
                  colSpan={DAYS_IN_WEEK + 2}
                  className="block px-3 py-6 text-muted-foreground max-md:px-0 max-md:py-3"
                >
                  <span className="block max-w-xs md:sticky md:left-3">
                    No rows yet. Add a project and task below, or copy last week.
                  </span>
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <GridRowView
                key={row.rowId}
                row={row}
                shown={shown[index] ?? row}
                index={index}
                drafts={props.drafts}
                days={days}
                readOnly={readOnly}
                path={props.path}
                over={isOver}
                capIds={capIds}
                open={isOpen(row.rowId)}
                noteLimit={props.noteLimit}
                onToggle={(next) => {
                  toggle(row.rowId, next);
                }}
                onEdit={props.onEdit}
                onLeave={props.onLeave}
                onMove={move}
                onOpenNote={openNote}
                onNoteKey={noteKey}
                onRemove={props.onRemove}
              />
            ))}
          </tbody>
          <tfoot role="rowgroup" className="max-md:grid max-md:gap-2 max-md:pt-2 md:block">
            <tr
              role="row"
              className={`font-medium max-md:grid max-md:grid-cols-7 max-md:gap-x-0.5 max-md:gap-y-1 max-md:rounded-lg max-md:bg-muted max-md:p-2.5 ${lineGrid}`}
            >
              <th
                scope="row"
                role="rowheader"
                className={`${sticky} px-3 py-2 max-md:col-span-7 max-md:p-0`}
              >
                Day total
              </th>
              {dayTotals(shown).map((sum, dow) => (
                <td
                  key={dow}
                  role="cell"
                  data-over={isOver[dow]}
                  data-label={dayLabel(days[dow] ?? '', dow)}
                  className="px-2 py-2 text-right tabular-nums data-[over=true]:bg-danger-surface data-[over=true]:text-danger max-md:flex max-md:flex-col max-md:items-center max-md:rounded-md max-md:p-0 max-md:before:w-min max-md:before:text-center max-md:before:text-xs max-md:before:leading-tight max-md:before:font-normal max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]"
                >
                  {formatHours(sum)}
                </td>
              ))}
              <td
                role="cell"
                data-label="Week total"
                className={`${dayLine} px-3 py-2 text-right tabular-nums max-md:col-span-7 max-md:mt-1 max-md:border-t max-md:border-border max-md:px-0 max-md:pt-2 max-md:text-base`}
              >
                {formatHours(weekTotal(shown))}
              </td>
            </tr>
            {over.length > 0 && (
              <tr role="row">
                <td
                  role="cell"
                  colSpan={DAYS_IN_WEEK + 2}
                  className="block px-3 pb-2 text-xs text-danger max-md:px-0 max-md:text-sm"
                >
                  <ul className="grid max-w-sm gap-0.5 md:sticky md:left-3">
                    {over.map((dow) => (
                      <li key={dow} id={capIds[dow] ?? ''}>
                        {dayCapMessage(dow)}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
