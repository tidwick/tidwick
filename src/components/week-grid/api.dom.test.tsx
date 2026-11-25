import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hoursLabel, renderGrid } from './grid-fixture';

const actions = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('astro:actions', () => ({
  actions: {
    entries: { save: actions.save },
    entriesFor: { save: actions.save },
    submission: { submit: actions.save },
  },
  isInputError: (error: { type?: string }) => error.type === 'AstroActionInputError',
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** The error Astro's client builds for a refusal: the same words from middleware now, an empty message before. */
const refused = (status: number, message: string) => ({
  error: { type: 'AstroActionError', status, message },
});

async function saveThatFails(result: ReturnType<typeof refused>): Promise<string> {
  actions.save.mockResolvedValue(result);
  const user = userEvent.setup();
  renderGrid();
  await user.type(
    screen.getByLabelText<HTMLInputElement>(hoursLabel('Garden wall', 'Survey', 'Friday')),
    '2',
  );
  await user.tab();
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).not.toBe('');
  });
  return screen.getByRole('alert').textContent;
}

describe('a save the middleware refuses says why in the grid', () => {
  it('a 401 carrying the catalog words shows those words', async () => {
    expect(await saveThatFails(refused(401, 'Sign in first'))).toBe('Sign in first');
  });

  it('a 403 with the step-up words shows them', async () => {
    const words = 'Confirm with your passkey to continue; it has been more than 15 minutes';
    expect(await saveThatFails(refused(403, words))).toBe(words);
  });

  it('a 401 with an empty message still shows a sentence chosen by its status', async () => {
    expect(await saveThatFails(refused(401, ''))).toMatch(/sign in again/);
  });

  it('a 403 with an empty message still shows a sentence chosen by its status', async () => {
    expect(await saveThatFails(refused(403, ''))).toMatch(/passkey/);
  });
});
