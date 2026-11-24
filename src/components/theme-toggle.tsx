import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Rendered on the server with no hydration: it stays hidden until the theme script (src/theme/theme.js) runs, since
// with no script there is nothing for it to do, and that script handles its click and keeps `aria-pressed` true
// while the dark theme is on. The sun shows in the dark theme and the moon in the light one, the theme it switches to.
export function ThemeToggle() {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      hidden
      data-theme-toggle=""
      aria-pressed="false"
      aria-label="Dark theme"
      className="border-control max-md:size-11"
    >
      <Sun aria-hidden="true" className="hidden dark:block" />
      <Moon aria-hidden="true" className="dark:hidden" />
    </Button>
  );
}
