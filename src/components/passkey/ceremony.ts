// Browser side of the passkey ceremonies, wired to buttons by data attributes. Uses the WebAuthn JSON helpers
// (parse*FromJSON, toJSON); a browser without them is told to update rather than failing silently.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { actions } from 'astro:actions';
import { wireCodes } from './codes';

const UNSUPPORTED = 'This browser cannot use passkeys here. Update it, or try another browser.';
const FAILED = 'That did not work. Try again.';
const CANCELLED = 'No passkey was used. Try again when you are ready.';

function say(text: string, tone: 'progress' | 'error' = 'progress'): void {
  const status = document.querySelector<HTMLElement>('[data-passkey-status]');
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function supported(): boolean {
  return (
    typeof PublicKeyCredential !== 'undefined' &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
  );
}

/** SimpleWebAuthn's JSON is the WebAuthn JSON shape with wider string types, so it parses as is. */
async function created(options: unknown): Promise<PublicKeyCredential | null> {
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
    options as PublicKeyCredentialCreationOptionsJSON,
  );
  const credential = await navigator.credentials.create({ publicKey }).catch(() => null);
  return credential instanceof PublicKeyCredential ? credential : null;
}

async function asserted(options: unknown): Promise<PublicKeyCredential | null> {
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(
    options as PublicKeyCredentialRequestOptionsJSON,
  );
  const credential = await navigator.credentials.get({ publicKey }).catch(() => null);
  return credential instanceof PublicKeyCredential ? credential : null;
}

/** Runs one ceremony from a button (`needsPasskey` false for one that uses no WebAuthn): disables it, reports progress and errors in the status line. */
function wire(
  selector: string,
  run: (button: HTMLButtonElement) => Promise<string | null>,
  needsPasskey = true,
): void {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (needsPasskey && !supported()) {
      say(UNSUPPORTED, 'error');
      return;
    }
    void (async () => {
      button.disabled = true;
      say('Waiting for your passkey…');
      let problem: string | null;
      try {
        problem = await run(button);
      } catch {
        problem = FAILED;
      } finally {
        button.disabled = false;
      }
      say(problem ?? '', 'error');
    })();
  });
}

/** The credential as WebAuthn JSON for an Action input; the server checks it in full, so the shape is taken as given. */
const registration = (c: PublicKeyCredential) => c.toJSON() as unknown as RegistrationResponseJSON;
const assertion = (c: PublicKeyCredential) => c.toJSON() as unknown as AuthenticationResponseJSON;

export function wireLogin(): void {
  wire('[data-passkey="login"]', async (button) => {
    const _csrf = button.dataset.csrf ?? '';
    const start = await actions.auth.loginOptions({ _csrf });
    if (start.error) return start.error.message;
    const credential = await asserted(start.data);
    if (!credential) return CANCELLED;
    const done = await actions.auth.loginVerify({
      _csrf,
      response: assertion(credential),
      return: button.dataset.return,
    });
    if (done.error) return done.error.message;
    window.location.assign(done.data.next);
    return null;
  });
}

/** Shows the ten recovery codes in the list marked `data-codes` and reveals its section. */
function showCodes(codes: readonly string[]): void {
  const list = document.querySelector('[data-codes]');
  if (!list) return;
  list.replaceChildren(
    ...codes.map((code) => {
      const item = document.createElement('li');
      item.textContent = code;
      item.dataset.code = '';
      return item;
    }),
  );
  document.querySelector('[data-enrol-start]')?.setAttribute('hidden', '');
  document.querySelector('[data-enrol-done]')?.removeAttribute('hidden');
  wireCodes();
  const heading = document.querySelector<HTMLElement>('[data-enrol-done] h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

export function wireEnrol(): void {
  wire('[data-passkey="enrol"]', async (button) => {
    const token = button.dataset.token ?? '';
    const _csrf = button.dataset.csrf ?? '';
    const start = await actions.auth.enrolOptions({ _csrf, token });
    if (start.error) return start.error.message;
    const credential = await created(start.data);
    if (!credential) return CANCELLED;
    const done = await actions.auth.enrolVerify({
      _csrf,
      token,
      response: registration(credential),
    });
    if (done.error) return done.error.message;
    showCodes(done.data.codes);
    return null;
  });
}

export function wireAddPasskey(): void {
  wire('[data-passkey="add"]', async (button) => {
    const _csrf = button.dataset.csrf ?? '';
    const start = await actions.auth.addPasskeyOptions({ _csrf });
    if (start.error) return start.error.message;
    const credential = await created(start.data);
    if (!credential) return CANCELLED;
    const done = await actions.auth.addPasskeyVerify({ _csrf, response: registration(credential) });
    if (done.error) return done.error.message;
    window.location.assign(done.data.next);
    return null;
  });
}

/** Confirms with a passkey for 15 minutes, then reloads so the page shows the new deadline. */
export function wireStepUp(): void {
  wire('[data-passkey="step-up"]', async (button) => {
    const _csrf = button.dataset.csrf ?? '';
    const start = await actions.auth.stepUpOptions({ _csrf });
    if (start.error) return start.error.message;
    const credential = await asserted(start.data);
    if (!credential) return CANCELLED;
    const done = await actions.auth.stepUpVerify({ _csrf, response: assertion(credential) });
    if (done.error) return done.error.message;
    window.location.reload();
    return null;
  });
}

/** Makes new recovery codes, then loads the account page, which shows them from their short-lived record so a reload keeps them. */
export function wireRegenerate(): void {
  wire(
    '[data-passkey="regen"]',
    async (button) => {
      const body = new FormData();
      body.set('_csrf', button.dataset.csrf ?? '');
      const done = await actions.auth.regenerateCodes(body);
      if (done.error) return done.error.message;
      window.location.assign('/account');
      return null;
    },
    false,
  );
}
