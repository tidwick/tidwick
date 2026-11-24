import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const script =
  import.meta.glob<string>('./theme.js', { query: '?raw', import: 'default', eager: true })[
    './theme.js'
  ] ?? '';
const KEY = 'tidwick-theme';

/** A fresh page that runs the script as a browser would: before the body exists, with the system setting given. */
function page(options: { dark: boolean; stored?: string; blocked?: boolean }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://timesheet.example/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const listeners = new Set<() => void>();
  const query = {
    matches: options.dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  };
  Object.defineProperty(window, 'matchMedia', { value: () => query });
  if (options.stored !== undefined) window.localStorage.setItem(KEY, options.stored);
  if (options.blocked) {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('blocked');
      },
    });
  }
  window.eval(script);
  const document = window.document;
  return {
    window,
    isDark: () => document.documentElement.classList.contains('dark'),
    system(dark: boolean) {
      query.matches = dark;
      listeners.forEach((listener) => {
        listener();
      });
    },
    toggle() {
      const button = document.createElement('button');
      button.hidden = true;
      button.setAttribute('data-theme-toggle', '');
      document.body.appendChild(button);
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
      return button;
    },
  };
}

describe('the theme script', () => {
  it('follows the system setting when nothing was chosen, and follows it as it changes', () => {
    const p = page({ dark: true });
    expect(p.isDark()).toBe(true);
    p.system(false);
    expect(p.isDark()).toBe(false);
  });

  it('a stored choice wins over the system setting before first paint', () => {
    expect(page({ dark: true, stored: 'light' }).isDark()).toBe(false);
    expect(page({ dark: false, stored: 'dark' }).isDark()).toBe(true);
  });

  it('the toggle flips the theme, keeps the choice, and shows itself with the state it is in', () => {
    const p = page({ dark: false });
    const button = p.toggle();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(p.isDark()).toBe(true);
    expect(p.window.localStorage.getItem(KEY)).toBe('dark');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(p.isDark()).toBe(false);
    expect(p.window.localStorage.getItem(KEY)).toBe('light');
  });

  it('a value that is not a theme is ignored', () => {
    expect(page({ dark: false, stored: 'sepia' }).isDark()).toBe(false);
    expect(page({ dark: true, stored: 'sepia' }).isDark()).toBe(true);
  });

  it('blocked storage still renders in the system theme and still toggles for the page', () => {
    const p = page({ dark: false, blocked: true });
    expect(p.isDark()).toBe(false);
    p.toggle().click();
    expect(p.isDark()).toBe(true);
  });
});
