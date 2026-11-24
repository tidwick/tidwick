// One day's cell: the hours input and the day's note line. Enter on the hours opens the row's notes and puts
// focus in this day's note; the arrow keys hand a move to the grid. Both fields post under the names the Action
// reads, and the markup is the same with script and without.
import { cellField } from '../../lib/week-form';
import { Input } from '../ui/input';
import { moveFor, type Move } from './cell-keys';
import { NoteLine, type NoteKey } from './note-line';

export interface CellProps {
  rowId: string;
  /** Position in the grid, for the arrow keys. */
  row: number;
  dow: number;
  /** Row label and day, for the screen reader: "Kitchen refit, Design, Monday". */
  label: string;
  /** The day as the column header shows it, for the ledger line. */
  day: string;
  hours: string;
  note: string;
  /** The typed hours are not a number. */
  invalid: boolean;
  /** The day this cell sits in is over the cap; `capId` is the inline message that says so. */
  over: boolean;
  capId: string;
  readOnly: boolean;
  noteLimit: number | null;
  onEdit: (part: 'hours' | 'note', value: string) => void;
  onLeave: () => void;
  onMove: (move: Move) => void;
  /** Enter on the hours: open the row's notes and focus this day's note. */
  onOpenNote: () => void;
  onNoteKey: (key: NoteKey) => void;
}

/** The hours sit in their day's column: the second line of a phone card, the first line of a wide row. */
const COLUMN = [
  'max-md:col-start-1 md:col-start-2',
  'max-md:col-start-2 md:col-start-3',
  'max-md:col-start-3 md:col-start-4',
  'max-md:col-start-4 md:col-start-5',
  'max-md:col-start-5 md:col-start-6',
  'max-md:col-start-6 md:col-start-7',
  'max-md:col-start-7 md:col-start-8',
];

export function GridCell(props: CellProps) {
  const { rowId, row, dow, label, hours, note, invalid, over, capId, readOnly } = props;
  return (
    <>
      <div
        data-over={over}
        className={`${COLUMN[dow] ?? ''} flex max-md:row-start-2 max-md:flex-col max-md:items-center max-md:gap-0.5 max-md:rounded-md md:row-start-1 md:justify-end md:px-2 md:py-2 data-[over=true]:bg-danger-surface`}
      >
        <span
          aria-hidden="true"
          data-phone-day
          className="w-min text-center text-xs leading-tight text-muted-foreground md:hidden"
        >
          {props.day}
        </span>
        <Input
          name={cellField(rowId, dow, 'hours')}
          value={hours}
          inputMode="decimal"
          autoComplete="off"
          data-row={row}
          data-day={dow}
          aria-label={`Hours, ${label}`}
          aria-invalid={invalid || over}
          aria-describedby={over ? capId : undefined}
          readOnly={readOnly}
          className="h-11 w-16 border-control px-2 text-right tabular-nums focus-visible:ring-ring max-md:w-full max-md:px-1 max-md:text-center md:h-9 md:scroll-ml-48 md:px-1.5 read-only:cursor-default read-only:border-transparent read-only:bg-transparent read-only:focus-visible:ring-0 dark:read-only:bg-transparent"
          onChange={(event) => {
            props.onEdit('hours', event.target.value);
          }}
          onFocus={(event) => {
            event.target.select();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.onOpenNote();
              return;
            }
            const move = moveFor(event);
            if (move === null) return;
            event.preventDefault();
            props.onMove(move);
          }}
          onBlur={props.onLeave}
        />
      </div>
      <NoteLine
        rowId={rowId}
        row={row}
        dow={dow}
        label={label}
        day={props.day}
        hours={hours}
        note={note}
        readOnly={readOnly}
        limit={props.noteLimit}
        onEdit={(value) => {
          props.onEdit('note', value);
        }}
        onLeave={props.onLeave}
        onKey={props.onNoteKey}
      />
    </>
  );
}
