// The owner's Submit week: with script, a click asks first, naming the hours the week holds and warning when it
// holds none, because a submitted week is locked until it is returned. With no script the button posts at once.
import { useEffect, useRef, useState } from 'react';
import { formatHours } from '../../lib/hours';
import { Button } from '../ui/button';

export interface SubmitWeekProps {
  /** Where the no-script button posts. */
  action: string;
  /** The week's hours in hundredths. */
  total: number;
  disabled: boolean;
  className: string;
  onConfirm: () => void;
}

export function SubmitWeek({ action, total, disabled, className, onConfirm }: SubmitWeekProps) {
  const [asking, setAsking] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) confirm.current?.focus();
  }, [asking]);
  if (!asking) {
    return (
      <Button
        type="submit"
        variant="outline"
        className={className}
        formAction={action}
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          setAsking(true);
        }}
      >
        Submit week
      </Button>
    );
  }
  return (
    <span role="group" aria-label="Confirm submit" className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium" role="status">
        {total === 0
          ? 'This week has no hours. Submit it empty?'
          : `Submit ${formatHours(total)} hours? The week locks until it is returned.`}
      </span>
      <Button
        ref={confirm}
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Confirm submit
      </Button>
      <Button
        type="button"
        variant="outline"
        className={`${className} border-control`}
        onClick={() => {
          setAsking(false);
        }}
      >
        Cancel
      </Button>
    </span>
  );
}
