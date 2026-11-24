import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

// A focused button draws a solid ring-coloured outline set off from its fill, because the translucent halo
// shadcn adds is about 2.4:1 against the page and the ring border is as dark as a primary fill (`just contrast`
// holds the ring token to 3:1 on every surface the outline sits on).
describe('a focused button is visible on its own fill', () => {
  for (const variant of ['default', 'outline', 'secondary', 'ghost', 'destructive'] as const) {
    it(`the ${variant} button draws a solid ring outline off its edge, not only a translucent halo`, () => {
      const classes = buttonVariants({ variant }).split(/\s+/);
      expect(classes).toContain('focus-visible:outline-2');
      expect(classes).toContain('focus-visible:outline-solid');
      expect(classes).toContain('focus-visible:outline-offset-2');
      expect(classes).toContain('focus-visible:outline-ring');
    });
  }
});
