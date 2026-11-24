// Asks the browser to confirm before the page is left while any edit is unsaved. The prompt's words belong to
// the browser; the grid's own "Unsaved changes" flag shows the same state beside the Save button.
import { useEffect } from 'react';

export function useUnsavedGuard(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) return undefined;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      window.removeEventListener('beforeunload', guard);
    };
  }, [unsaved]);
}
