// Class strings the four auth pages share, built from the button component's own variants so a button here is
// the same button as everywhere else, only taller for a thumb. Fields on these pages are `ui/input.tsx`.
import { cn } from 'cn';
import { buttonVariants } from '../ui/button';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const TALL = 'min-h-11 px-4 text-base font-medium';

export const PRIMARY = cn(buttonVariants({ variant: 'default' }), TALL, 'w-full');
export const SECONDARY = cn(buttonVariants({ variant: 'outline' }), TALL, 'border-control');
export const DANGER = cn(
  buttonVariants({ variant: 'outline' }),
  TALL,
  'border-danger text-danger hover:bg-danger-surface hover:text-danger',
);
export const LINK = `underline underline-offset-2 ${FOCUS}`;
