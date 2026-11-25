import { readFileSync } from 'node:fs';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { dayLabel } from '../../lib/week';
import { DAYS, ROWS, renderGrid, row, toggle } from './grid-fixture';

vi.mock('./api', () => ({
  saveCells: vi.fn(() => Promise.resolve({ ok: false, message: 'not saved in this test' })),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));

// Below `md` a row is a short card: the project and its total on the first line, a strip of seven hours fields,
// and a notes toggle that opens the row's seven note lines. jsdom lays nothing out, so these tests hold
// the markup and the classes the layout rests on; the shots in the stage report show the result.
const TEN = Array.from({ length: 10 }, (_, i) =>
  row(`t${String(i)}`, `Project ${String(i)}`, 'Design', { 0: 400 }),
);
const classOf = (el: Element | null | undefined): string => el?.getAttribute('class') ?? '';
const phoneHidden = (el: Element | null | undefined): boolean =>
  /(^|\s)max-md:hidden(\s|$)/.test(classOf(el));

describe('a week of ten rows on a phone', () => {
  it('has a card per row, each with seven hours fields, seven note fields and one notes toggle that a phone shows', () => {
    renderGrid({ rows: TEN });
    const cards = screen.getAllByRole('row').slice(1, 11);
    expect(cards).toHaveLength(10);
    for (const card of cards) {
      expect(card.querySelectorAll('input[name$=".hours"]')).toHaveLength(7);
      expect(card.querySelectorAll('textarea[name$=".note"]')).toHaveLength(7);
      const details = card.querySelectorAll('details');
      expect(details).toHaveLength(1);
      for (let el: Element | null = details[0] ?? null; el && el !== card; el = el.parentElement) {
        expect(phoneHidden(el), el.outerHTML.slice(0, 80)).toBe(false);
      }
    }
  });

  it('puts the row total on the first line of the card beside the project, and the days in one strip below', () => {
    renderGrid({ rows: TEN });
    const card = screen.getAllByRole('row')[1];
    const header = within(card as HTMLElement).getByRole('rowheader');
    expect(classOf(header)).toContain('max-md:col-span-5');
    expect(classOf(header)).toContain('max-md:row-start-1');
    const cells = within(card as HTMLElement).getAllByRole('cell');
    const total = cells[cells.length - 1];
    expect(total?.getAttribute('data-label')).toBe('Total');
    expect(classOf(total)).toContain('max-md:row-start-1');
    const hours = within(card as HTMLElement).getAllByLabelText(/^Hours, /);
    hours.forEach((field, dow) => {
      expect(classOf(field.parentElement), `day ${String(dow)}`).toContain(
        `max-md:col-start-${String(dow + 1)}`,
      );
      expect(classOf(field.parentElement)).toContain('max-md:row-start-2');
      expect(classOf(field), `day ${String(dow)}`).toContain('max-md:w-full');
      expect(classOf(field)).toContain('h-11');
    });
  });

  it('names each day above its hours field, in text a screen reader skips because the field is labelled', () => {
    renderGrid({ rows: ROWS });
    const card = screen.getByRole('row', { name: /Garden wall/ });
    const hours = within(card).getAllByLabelText(/^Hours, /);
    hours.forEach((field, dow) => {
      const label = field.parentElement?.querySelector('[data-phone-day]');
      expect(label?.textContent).toBe(dayLabel(DAYS[dow] ?? '', dow));
      expect(label?.getAttribute('aria-hidden')).toBe('true');
      expect(classOf(label)).toContain('md:hidden');
    });
  });

  it('shows a day’s note only once its row’s notes are open, by the stylesheet, and the field is posted either way', () => {
    renderGrid({ rows: ROWS });
    const field = screen.getByLabelText('Note, Garden wall, Survey, Monday');
    const line = field.closest('[data-note-line]');
    expect(classOf(line)).toMatch(/(^|\s)hidden(\s|$)/);
    expect(classOf(line)).toContain('group-has-[details[open]]/row:max-md:flex');
    expect(field.getAttribute('name')).toMatch(/^cell\..+\.0\.note$/);
    expect(field.closest('form')).toBeTruthy();
  });

  it('the notes toggle counts the notes written in the row and follows what is typed', async () => {
    const user = userEvent.setup();
    renderGrid({ rows: ROWS });
    expect(toggle('Kitchen refit, Design').textContent).toBe('Notes (1), Kitchen refit, Design');
    expect(toggle('Kitchen refit, Review').textContent).toBe('Notes, Kitchen refit, Review');
    await user.type(screen.getByLabelText('Note, Kitchen refit, Review, Friday'), 'second visit');
    expect(toggle('Kitchen refit, Review').textContent).toBe('Notes (1), Kitchen refit, Review');
    await user.clear(screen.getByLabelText('Note, Kitchen refit, Design, Monday'));
    expect(toggle('Kitchen refit, Design').textContent).toBe('Notes, Kitchen refit, Design');
  });

  it('opens every row’s notes from one box that a phone shows too', async () => {
    const user = userEvent.setup();
    renderGrid({ rows: TEN });
    const box = screen.getByRole('checkbox', { name: 'Open all notes' });
    expect(phoneHidden(box.closest('label'))).toBe(false);
    await user.click(box);
    expect([...document.querySelectorAll('details')].every((d) => d.open)).toBe(true);
  });
});

describe('the bar at the foot of the grid keeps the week total in view on a phone', () => {
  it('sticks to the foot of the window at every width and puts the total on a line of its own above the buttons', () => {
    renderGrid({ rows: TEN });
    const total = screen.getByLabelText('Week total', { selector: 'output' });
    const bar = total.closest('div');
    expect(classOf(bar)).toMatch(/(^|\s)sticky(\s|$)/);
    expect(classOf(bar)).toMatch(/(^|\s)bottom-0(\s|$)/);
    expect(phoneHidden(total.parentElement)).toBe(false);
    expect(classOf(total.parentElement)).toContain('max-md:order-first');
    expect(total.textContent).toBe(String(10 * 4));
  });

  it('leaves room under the window for the bar, so a control reached by Tab is scrolled clear of it', () => {
    const css = readFileSync('src/styles/global.css', 'utf8');
    const padding = /html\s*\{[^}]*scroll-padding-bottom:\s*(\d+(?:\.\d+)?)rem/.exec(css);
    expect(padding, 'html needs scroll-padding-bottom in global.css').not.toBeNull();
    // The bar is a total line, a row of 44px buttons and 0.75rem of padding at each edge: under 7rem.
    expect(Number(padding?.[1])).toBeGreaterThanOrEqual(6.5);
  });
});
