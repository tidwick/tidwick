// One day's line of a row's ledger: the date, the hours and the note field, with a counter once a note is
// written, when the export mapping keeps only so much of it. It leaves the row's columns and stacks under the
// row, a line of day and note on a phone and a line of the grid's columns on a wide screen, shown while the row's
// notes are open or "Open all notes" is checked. A read-only ledger leaves out a day with no hours and no note,
// and draws the fields it keeps as plain text. The note is a controlled text value, never markup (SEC-21);
// the counter only informs.
import { useId, type KeyboardEvent } from 'react';
import { NOTE_MAX } from '../../lib/week';
import { cellField } from '../../lib/week-form';
import { Textarea } from '../ui/textarea';

export type NoteKey = 'next' | 'back';

export interface NoteLineProps {
  rowId: string;
  row: number;
  dow: number;
  /** Row label and day, for the screen reader: "Kitchen refit, Design, Monday". */
  label: string;
  /** The day as the column header shows it, and the hours as typed. */
  day: string;
  hours: string;
  note: string;
  readOnly: boolean;
  /** The export mapping's note limit, or null when it sets none and no counter shows. */
  limit: number | null;
  onEdit: (value: string) => void;
  onLeave: () => void;
  onKey: (key: NoteKey) => void;
}

/** Shown only while the row's `<details>` is open or the grid's "Open all notes" box is checked. */
const SHOWN =
  'hidden group-has-[details[open]]/row:max-md:flex group-has-[:checked]/notes:max-md:flex max-md:col-span-7 max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-1 md:group-has-[details[open]]/row:grid md:group-has-[:checked]/notes:grid md:col-span-full md:grid-cols-subgrid md:items-start';

function keyOf(event: KeyboardEvent<HTMLTextAreaElement>): NoteKey | null {
  if (event.nativeEvent.isComposing) return null;
  if (event.key === 'Escape') return 'back';
  const held = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
  return event.key === 'Enter' && !held ? 'next' : null;
}

export function NoteLine(props: NoteLineProps) {
  const { rowId, row, dow, label, day, hours, note, readOnly, limit } = props;
  const counter = useId();
  const length = Array.from(note.trim()).length;
  const past = limit !== null && length > limit;
  // A read-only ledger draws only the days that hold something; the owner's editable one keeps all seven lines.
  if (readOnly && hours === '' && length === 0) return null;
  return (
    <div data-note-line className={`${SHOWN} ${readOnly ? 'md:py-0' : 'md:py-1'}`}>
      <span
        aria-hidden="true"
        className={`px-3 text-right text-muted-foreground ${readOnly ? 'py-1' : 'py-2'} max-md:w-20 max-md:shrink-0 max-md:p-0 max-md:text-left max-md:text-sm`}
      >
        {day}
      </span>
      <span
        aria-hidden="true"
        className={`px-2 text-right tabular-nums max-md:hidden ${readOnly ? 'py-1' : 'py-2'}`}
      >
        {hours === '' ? '–' : hours}
      </span>
      <Textarea
        name={cellField(rowId, dow, 'note')}
        value={note}
        rows={1}
        maxLength={NOTE_MAX}
        readOnly={readOnly}
        data-row={row}
        data-day={dow}
        aria-label={`Note, ${label}`}
        aria-describedby={limit === null ? undefined : counter}
        className={`min-h-9 resize-y border-control field-sizing-content read-only:min-h-0 max-md:read-only:min-h-0 read-only:cursor-default read-only:resize-none read-only:border-0 read-only:py-0.5 read-only:bg-transparent read-only:px-0 dark:read-only:bg-transparent focus-visible:ring-ring max-h-40 max-md:min-h-11 max-md:min-w-0 max-md:flex-1 ${limit === null ? 'md:col-span-7' : 'md:col-span-5'}`}
        onChange={(event) => {
          props.onEdit(event.target.value);
        }}
        onBlur={props.onLeave}
        onKeyDown={(event) => {
          const key = keyOf(event);
          if (key === null) return;
          event.preventDefault();
          props.onKey(key);
        }}
      />
      {limit !== null && (
        <p
          id={counter}
          className={`px-2 text-xs tabular-nums max-md:basis-full max-md:pl-[5.5rem] md:col-span-2 ${readOnly ? 'md:py-1' : 'md:py-2.5'} ${past ? 'font-medium text-notice' : 'text-muted-foreground'}`}
        >
          {length === 0
            ? ''
            : past
              ? `${String(length)} of ${String(limit)}: the export keeps the first ${String(limit)}`
              : `${String(length)} of ${String(limit)}`}
        </p>
      )}
    </div>
  );
}
