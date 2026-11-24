// What the grid says about itself. The notice is the week's standing state in words and exists only while there
// is one. The two live regions, one alert for a failed save or a refused post and one status for everything
// else, exist from the first render so a screen reader announces what lands in them; they sit in the bar at the
// foot of the window, beside the controls that cause the message, and hold no height while empty.
export interface Message {
  kind: 'error' | 'info';
  text: string;
}

export function GridNotice({ notice }: { notice: string }) {
  return notice === '' ? null : <p className="text-sm text-muted-foreground">{notice}</p>;
}

export function GridMessages({ message }: { message: Message | null }) {
  return (
    <div className="min-w-0 text-sm">
      <p role="alert" className="text-danger">
        {message?.kind === 'error' ? message.text : ''}
      </p>
      <p role="status" className="text-muted-foreground">
        {message?.kind === 'info' ? message.text : ''}
      </p>
    </div>
  );
}
