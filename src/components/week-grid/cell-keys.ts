// The keys of the week grid: which key asks to leave a cell, and where it lands. Up and down always move a row;
// left and right move a day only when the caret is already at that end of the text, so editing is not taken
// away. A key held with a modifier belongs to the text field (select, word jump). Enter in a note goes on to the
// next day's hours, and from Sunday to the next row's Monday.

export type Move = 'up' | 'down' | 'left' | 'right';

interface KeyEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  currentTarget: HTMLInputElement;
}

/** The move a key asks of an hours cell, or null when the key is the text field's own. */
export function moveFor(event: KeyEvent): Move | null {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null;
  const { selectionStart: start, selectionEnd: end, value } = event.currentTarget;
  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return start === 0 && (end === 0 || end === value.length) ? 'left' : null;
    case 'ArrowRight':
      return end === value.length && (start === end || start === 0) ? 'right' : null;
    default:
      return null;
  }
}

/** Where a move from (row, day) lands in a grid of `rows` rows and seven days; the edge stays put. */
export function landing(move: Move, row: number, dow: number, rows: number, days = 7) {
  const next = {
    up: { row: row - 1, dow },
    down: { row: row + 1, dow },
    left: { row, dow: dow - 1 },
    right: { row, dow: dow + 1 },
  }[move];
  const inside = next.row >= 0 && next.row < rows && next.dow >= 0 && next.dow < days;
  return inside ? next : { row, dow };
}

/** Where Enter in the note at (row, day) lands: the next day's hours, wrapping to the next row, or its own hours. */
export function afterNote(row: number, dow: number, rows: number, days = 7) {
  if (dow + 1 < days) return { row, dow: dow + 1 };
  return row + 1 < rows ? { row: row + 1, dow: 0 } : { row, dow };
}

/** Focuses the hours input, or the note, at (row, day) under `root`; false when there is none. */
export function focusCell(
  root: HTMLElement,
  row: number,
  dow: number,
  part: 'hours' | 'note' = 'hours',
): boolean {
  const tag = part === 'hours' ? 'input' : 'textarea';
  const field = root.querySelector<HTMLElement>(
    `${tag}[data-row="${String(row)}"][data-day="${String(dow)}"]`,
  );
  field?.focus();
  return field !== null;
}
