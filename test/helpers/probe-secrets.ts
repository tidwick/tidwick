// Secrets of every kind a request or a job can hold, fresh per call, for the logging probes to inject and then
// look for. Synthetic values only.

const random = (bytes: number): Uint8Array => crypto.getRandomValues(new Uint8Array(bytes));
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const hexOf = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** One of each kind of secret a request or a job can hold. */
export function secrets(): Record<string, string> {
  const session = b64url(random(32));
  return {
    session,
    cookie: `__Host-tidwick-session=${session}`,
    enrolment: b64url(random(32)),
    recoveryCode: 'K7Q2M9X4T1V8B3N6',
    note: `client meeting about the merger ${crypto.randomUUID()}`,
    kek: btoa(String.fromCharCode(...random(32))),
    keyBytes: hexOf(random(32)),
  };
}
