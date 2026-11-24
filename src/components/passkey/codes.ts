// The recovery-code step after enrolment: copy, print, and a confirmation before the person may leave.
// Codes are shown once, so leaving by any route before the box is ticked asks first.

function note(text: string): void {
  const line = document.querySelector('[data-codes-note]');
  if (line) line.textContent = text;
}

function codeText(): string {
  return [...document.querySelectorAll('[data-codes] > li')].map((li) => li.textContent).join('\n');
}

async function copyCodes(): Promise<void> {
  try {
    await navigator.clipboard.writeText(codeText());
    note('Copied. Paste them somewhere safe, such as a password manager.');
  } catch {
    note('Copying was blocked. Select the codes and copy them by hand, or print them.');
  }
}

export function wireCodes(): void {
  const confirm = document.querySelector<HTMLInputElement>('[data-codes-confirm]');
  const next = document.querySelector<HTMLAnchorElement>('[data-codes-continue]');
  if (!confirm || !next) return;
  const leaving = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };
  window.addEventListener('beforeunload', leaving);
  confirm.addEventListener('change', () => {
    next.setAttribute('aria-disabled', confirm.checked ? 'false' : 'true');
    if (confirm.checked) window.removeEventListener('beforeunload', leaving);
    else window.addEventListener('beforeunload', leaving);
  });
  next.addEventListener('click', (event) => {
    if (!confirm.checked) {
      event.preventDefault();
      note('Tick the box to say you saved the codes, then continue.');
    }
  });
  document.querySelector('[data-codes-copy]')?.addEventListener('click', () => void copyCodes());
  document.querySelector('[data-codes-print]')?.addEventListener('click', () => {
    window.print();
  });
}
