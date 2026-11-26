import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ stepUpOptions: vi.fn(), regenerateCodes: vi.fn() }));
vi.mock('astro:actions', () => ({
  actions: {
    auth: { stepUpOptions: actions.stepUpOptions, regenerateCodes: actions.regenerateCodes },
  },
}));

import { wireRegenerate, wireStepUp } from './ceremony';

const PAGE = `
  <div data-enrol-start>
    <button type="button" data-passkey="step-up" data-csrf="t">Confirm</button>
    <button type="submit" data-passkey="regen" data-csrf="t">Make new codes</button>
    <p data-passkey-status></p>
  </div>
  <section data-enrol-done hidden><h1>Codes</h1><ol data-codes></ol></section>`;

const button = (kind: string) =>
  document.querySelector<HTMLButtonElement>(`[data-passkey="${kind}"]`);
const status = () => document.querySelector('[data-passkey-status]')?.textContent;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = PAGE;
  vi.stubGlobal('PublicKeyCredential', {
    parseCreationOptionsFromJSON: () => ({}),
    parseRequestOptionsFromJSON: () => ({}),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('a ceremony button comes back after a rejected call', () => {
  it('re-enables and says so when the action rejects', async () => {
    actions.stepUpOptions.mockRejectedValue(new Error('network down'));
    wireStepUp();
    button('step-up')?.click();
    expect(button('step-up')?.disabled).toBe(true);
    await settle();
    expect(button('step-up')?.disabled).toBe(false);
    expect(status()).toMatch(/did not work/);
  });

  it('re-enables and shows the server message when the action answers with an error', async () => {
    actions.stepUpOptions.mockResolvedValue({ error: { message: 'Sign in first' } });
    wireStepUp();
    button('step-up')?.click();
    await settle();
    expect(button('step-up')?.disabled).toBe(false);
    expect(status()).toBe('Sign in first');
  });
});

describe('regenerated recovery codes go through the codes step', () => {
  it('shows the ten codes in the step and hides the page behind it', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-000${String(i)}`);
    actions.regenerateCodes.mockResolvedValue({ data: { codes } });
    wireRegenerate();
    button('regen')?.click();
    await settle();
    expect(document.querySelectorAll('[data-codes] > li')).toHaveLength(10);
    expect(document.querySelector('[data-enrol-done]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-enrol-start]')?.hasAttribute('hidden')).toBe(true);
  });

  it('leaves the page alone and re-enables the button when the action fails', async () => {
    actions.regenerateCodes.mockResolvedValue({ error: { message: 'Confirm first' } });
    wireRegenerate();
    button('regen')?.click();
    await settle();
    expect(document.querySelector('[data-enrol-done]')?.hasAttribute('hidden')).toBe(true);
    expect(button('regen')?.disabled).toBe(false);
    expect(status()).toBe('Confirm first');
  });
});
