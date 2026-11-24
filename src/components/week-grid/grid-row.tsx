// One grid row: the project and task, the days that hold hours and no note, a Remove button, the row's notes
// toggle, seven cells and the row's total. The toggle is a native `<details>`: opening it shows the row's
// ledger, one line per day, under the row on a wide screen and under the strip of hours on a phone, where the
// row is a short card.
import { formatHours } from '../../lib/hours';
import {
  DAY_NAMES,
  dayLabel,
  isRemovable,
  rowTotal,
  type Cell,
  type GridRow,
} from '../../lib/week';
import type { Move } from './cell-keys';
import { GridCell } from './cell';
import { draftKey, hoursInvalid, hoursText, noteText, type Drafts } from './drafts';
import type { NoteKey } from './note-line';
import { RowRemove } from './row-remove';

export interface GridRowViewProps {
  row: GridRow;
  /** The same row with unsaved edits applied, for its total, its hint and whether it may be removed. */
  shown: GridRow;
  index: number;
  drafts: Drafts;
  /** The week's seven dates, for each day cell's label on the phone and each ledger line. */
  days: readonly string[];
  readOnly: boolean;
  path: string;
  /** Whether each day is over the cap, and the id of the message under that day. */
  over: readonly boolean[];
  capIds: readonly string[];
  /** Whether the row's ledger is open. */
  open: boolean;
  noteLimit: number | null;
  onToggle: (open: boolean) => void;
  onEdit: (rowId: string, dow: number, part: 'hours' | 'note', value: string) => void;
  onLeave: () => void;
  onMove: (row: number, dow: number, move: Move) => void;
  onOpenNote: (row: number, dow: number) => void;
  onNoteKey: (row: number, dow: number, key: NoteKey) => void;
  /** Absent when rows cannot be removed here, as when editing another person's week through the lock. */
  onRemove?: ((rowId: string) => void) | undefined;
}

export const sticky = 'text-left md:sticky md:left-0 md:z-10 md:bg-background';

/** Every line of the grid on a wide screen: the label column, seven days and the total, the same in every row. */
export const lineGrid =
  'md:grid md:grid-cols-[minmax(12rem,16rem)_repeat(7,minmax(5rem,1fr))_minmax(5rem,auto)]';

/** The phone layout turns a cell into a line that names its day before the field, from `data-label`. */
export const dayLine =
  'max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:rounded-md max-md:px-2 max-md:py-1 max-md:before:font-normal max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]';

/** A day cell holds no box of its own: its hours and note join the row's grid, in a strip on a phone and in columns on a wide screen. */
const dayCell = 'contents';

/** The row total: on a phone the right of the card's first line, under a small "Total". */
const totalCell =
  'px-3 py-2 text-right font-medium tabular-nums max-md:col-span-2 max-md:col-start-6 max-md:row-start-1 max-md:flex max-md:flex-col max-md:items-end max-md:p-0 max-md:text-base max-md:before:text-xs max-md:before:font-normal max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)] md:col-start-9 md:row-start-1';

/** How many days of the row carry a note, for the notes toggle. */
const noteCount = (cells: readonly Cell[]): number =>
  cells.filter((c) => c.note.trim() !== '').length;

/** "Hours with no note: Tue, Thu", or null when every day with hours has its note. */
export function missingNotes(cells: readonly Cell[]): string | null {
  const days = cells.flatMap((cell, dow) =>
    cell.hundredths > 0 && cell.note === '' ? [DAY_NAMES[dow]?.slice(0, 3) ?? ''] : [],
  );
  return days.length === 0 ? null : `Hours with no note: ${days.join(', ')}`;
}

export function GridRowView(props: GridRowViewProps) {
  const { row, shown, index, drafts, days, readOnly, path, over, capIds, onRemove } = props;
  const label = `${row.project}, ${row.task}`;
  const hint = missingNotes(shown.cells);
  const notes = noteCount(shown.cells);
  return (
    <tr
      role="row"
      className={`group/row border-b border-border align-top max-md:grid max-md:grid-cols-7 max-md:gap-x-0.5 max-md:gap-y-2 max-md:rounded-lg max-md:border max-md:p-2.5 ${lineGrid}`}
    >
      <th
        scope="row"
        role="rowheader"
        className={`${sticky} px-3 py-1.5 font-normal max-md:col-span-5 max-md:col-start-1 max-md:row-start-1 max-md:p-0 md:col-start-1 md:row-start-1`}
      >
        <span className="block font-medium">{row.project}</span>
        <span className="block text-muted-foreground">
          {row.client} &middot; {row.taskCode} &middot; {row.task}
        </span>
        {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
        <div className="flex items-center gap-x-4 max-md:gap-x-6">
          {!readOnly && onRemove && (
            <RowRemove
              rowId={row.rowId}
              label={label}
              path={path}
              blocked={!row.removable || !isRemovable(shown.cells)}
              onRemove={onRemove}
            />
          )}
          <details
            open={props.open}
            className="mt-0"
            onToggle={(event) => {
              props.onToggle(event.currentTarget.open);
            }}
          >
            <summary className="flex min-h-6 w-fit cursor-pointer items-center rounded-sm text-sm text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring max-md:min-h-11">
              Notes{notes > 0 && ` (${String(notes)})`}
              <span className="sr-only">, {label}</span>
            </summary>
          </details>
        </div>
      </th>
      {row.cells.map((cell, dow) => {
        const draft = drafts[draftKey(row.rowId, dow)];
        const day = dayLabel(days[dow] ?? '', dow);
        return (
          <td key={dow} role="cell" className={dayCell} data-label={day}>
            <GridCell
              rowId={row.rowId}
              row={index}
              dow={dow}
              label={`${label}, ${DAY_NAMES[dow] ?? ''}`}
              day={day}
              hours={hoursText(cell, draft)}
              note={noteText(cell, draft)}
              invalid={hoursInvalid(draft)}
              over={over[dow] ?? false}
              capId={capIds[dow] ?? ''}
              readOnly={readOnly}
              noteLimit={props.noteLimit}
              onEdit={(part, value) => {
                props.onEdit(row.rowId, dow, part, value);
              }}
              onLeave={props.onLeave}
              onMove={(move) => {
                props.onMove(index, dow, move);
              }}
              onOpenNote={() => {
                props.onOpenNote(index, dow);
              }}
              onNoteKey={(key) => {
                props.onNoteKey(index, dow, key);
              }}
            />
          </td>
        );
      })}
      <td role="cell" data-label="Total" className={totalCell}>
        {formatHours(rowTotal(shown.cells))}
      </td>
    </tr>
  );
}
