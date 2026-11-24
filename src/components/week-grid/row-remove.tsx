// A row's Remove button. It stays focusable when it cannot act, so a keyboard user finds it and hears why: the
// reason is the catalog's own words, attached as its description. Without script it still posts, and the Action
// refuses a row that holds anything.
import { useId } from 'react';
import { errorMessage } from '../../lib/errors';
import { Button } from '../ui/button';

export interface RowRemoveProps {
  rowId: string;
  /** "Kitchen refit, Design", for the screen reader. */
  label: string;
  path: string;
  /** The row holds hours or a note, so removing it would lose them. */
  blocked: boolean;
  onRemove: (rowId: string) => void;
}

const REASON = errorMessage('row_not_empty');

export function RowRemove({ rowId, label, path, blocked, onRemove }: RowRemoveProps) {
  const reason = useId();
  return (
    <>
      <Button
        type="submit"
        variant="ghost"
        size="xs"
        name="rowId"
        value={rowId}
        formAction={`${path}?_action=entries.removeRow`}
        aria-label={`Remove row: ${label}`}
        aria-disabled={blocked}
        aria-describedby={blocked ? reason : undefined}
        title={blocked ? REASON : undefined}
        className="min-h-6 px-0 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60 max-md:h-11 max-md:min-w-11 max-md:justify-start"
        onClick={(event) => {
          event.preventDefault();
          if (!blocked) onRemove(rowId);
        }}
      >
        Remove
      </Button>
      {blocked && (
        <span id={reason} className="sr-only">
          {REASON}
        </span>
      )}
    </>
  );
}
