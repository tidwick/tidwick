// The sign-in providers an operator allows: `SSO_PROVIDERS`, a JSON array, one entry per identity provider tenant,
// each with its client secret in `SSO_SECRET_<ID>`. Unset or empty means SSO is off. Pure: the env reader hands it
// the raw values, so no binding is read here (ADR 0003).
import { fail } from './errors';

export interface SsoProvider {
  readonly id: string;
  /** The button text: "Entra ID", "Google". */
  readonly label: string;
  /** Equal to the `issuer` of the provider's discovery document, so a multi-tenant endpoint never matches. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** A Google Workspace domain the `hd` claim must name, or null. */
  readonly hd: string | null;
}

export const SSO_LABEL_MAX = 40;
const ID = /^[a-z0-9-]{1,24}$/;
const DOMAIN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const KEYS: ReadonlySet<string> = new Set(['id', 'label', 'issuer', 'client_id', 'hd']);
/** `{"id":"google"}` needs no issuer or label. */
const PRESETS: Readonly<Record<string, { issuer: string; label: string }>> = {
  google: { issuer: 'https://accounts.google.com', label: 'Google' },
};

/** The Worker secret that holds a provider's client secret: `SSO_SECRET_` and the id upper-cased, `-` as `_`. */
export const ssoSecretName = (id: string): string =>
  `SSO_SECRET_${id.toUpperCase().replaceAll('-', '_')}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function field(entry: Record<string, unknown>, key: string, max: number): string | null {
  const value = entry[key];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    fail('missing_binding', 'SSO_PROVIDERS');
  return value;
}

function httpsIssuer(value: string): string {
  if (!URL.canParse(value) || new URL(value).protocol !== 'https:' || value.includes('#'))
    fail('missing_binding', 'SSO_PROVIDERS');
  return value;
}

function provider(entry: unknown, source: Record<string, unknown>): SsoProvider {
  if (!isRecord(entry) || Object.keys(entry).some((key) => !KEYS.has(key)))
    fail('missing_binding', 'SSO_PROVIDERS');
  const id = field(entry, 'id', 24);
  if (id === null || !ID.test(id)) fail('missing_binding', 'SSO_PROVIDERS');
  const preset = PRESETS[id];
  const issuer = field(entry, 'issuer', 300) ?? preset?.issuer;
  const label = field(entry, 'label', SSO_LABEL_MAX) ?? preset?.label;
  const clientId = field(entry, 'client_id', 300);
  const hd = field(entry, 'hd', 253);
  if (issuer === undefined || label === undefined || clientId === null)
    fail('missing_binding', 'SSO_PROVIDERS');
  if (hd !== null && !DOMAIN.test(hd)) fail('missing_binding', 'SSO_PROVIDERS');
  const name = ssoSecretName(id);
  const secret = source[name];
  if (typeof secret !== 'string' || secret.trim() === '') fail('missing_binding', name);
  return { id, label, issuer: httpsIssuer(issuer), clientId, clientSecret: secret, hd };
}

/** The allowed providers; an unset or empty `SSO_PROVIDERS` is none. Any malformed, repeated or secretless entry fails by name. */
export function ssoProviders(source: Record<string, unknown>): readonly SsoProvider[] {
  const raw = source['SSO_PROVIDERS'];
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return [];
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    fail('missing_binding', 'SSO_PROVIDERS');
  }
  if (!Array.isArray(parsed)) fail('missing_binding', 'SSO_PROVIDERS');
  const providers = parsed.map((entry) => provider(entry, source));
  const unique = (pick: (p: SsoProvider) => string) =>
    new Set(providers.map(pick)).size === providers.length;
  if (!unique((p) => p.id) || !unique((p) => p.issuer)) fail('missing_binding', 'SSO_PROVIDERS');
  return providers;
}
