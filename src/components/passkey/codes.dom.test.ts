import { afterEach, describe, expect, it } from 'vitest';
import { wireCodes } from './codes';

// The recovery-codes step as `[token].astro` renders it once the codes are shown.
const STEP = `
  <p data-codes-note role="status"></p>
  <label><input type="checkbox" data-codes-confirm />I have saved these codes. I understand they will not be shown again.</label>
  <a href="/week" data-codes-continue aria-disabled="true">Continue</a>`;

const link = () => document.querySelector<HTMLAnchorElement>('[data-codes-continue]');
const box = () => document.querySelector<HTMLInputElement>('[data-codes-confirm]');

afterEach(() => {
  document.body.innerHTML = '';
});

/** Clicks Continue and says whether the step's own handler refused it; jsdom cannot follow the link anyway. */
function refused(): boolean {
  let prevented = false;
  const seen = (event: Event): void => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', seen, { once: true });
  link()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return prevented;
}

describe('the recovery-codes step gates Continue on the confirmation box', () => {
  it('Continue stays disabled and a click on it is refused with a note until the box is ticked', () => {
    document.body.innerHTML = STEP;
    wireCodes();
    expect(link()?.getAttribute('aria-disabled')).toBe('true');
    expect(refused()).toBe(true);
    expect(document.querySelector('[data-codes-note]')?.textContent).toMatch(/Tick the box/);
  });

  it('ticking the box enables Continue and unticking it disables it again', () => {
    document.body.innerHTML = STEP;
    wireCodes();
    box()?.click();
    expect(link()?.getAttribute('aria-disabled')).toBe('false');
    expect(refused()).toBe(false);
    box()?.click();
    expect(link()?.getAttribute('aria-disabled')).toBe('true');
  });
});
