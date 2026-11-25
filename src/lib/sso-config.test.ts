import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { ssoProviders, ssoSecretName } from './sso-config';

const A = {
  id: 'tenant-a',
  label: 'Tenant A',
  issuer: 'https://idp-a.example/a/v2.0',
  client_id: 'ca',
};
const B = {
  id: 'tenant-b',
  label: 'Tenant B',
  issuer: 'https://idp-b.example/b/v2.0',
  client_id: 'cb',
};
const SECRETS = {
  SSO_SECRET_TENANT_A: 'secret-a',
  SSO_SECRET_TENANT_B: 'secret-b',
  SSO_SECRET_GOOGLE: 'g',
};

const source = (providers: unknown, extra: Record<string, unknown> = SECRETS) => ({
  SSO_PROVIDERS: typeof providers === 'string' ? providers : JSON.stringify(providers),
  ...extra,
});

const read = (input: Record<string, unknown>) =>
  ssoProviders(typeof input.SSO_PROVIDERS === 'string' ? input.SSO_PROVIDERS : null, input);

function detailOf(input: Record<string, unknown>): string | undefined {
  try {
    read(input);
  } catch (error) {
    if (error instanceof AppError && error.code === 'missing_binding') return error.detail;
    throw error;
  }
  return expect.unreachable('the config was accepted');
}

describe('SSO_PROVIDERS', () => {
  it('is off when unset, empty or an empty list', () => {
    expect(ssoProviders(null, {})).toEqual([]);
    expect(read(source([]))).toEqual([]);
  });

  it('reads one entry per tenant, each with its own secret named from its id', () => {
    const [a, b] = read(source([A, { ...B, hd: 'practice.example' }]));
    expect(a).toEqual({
      id: 'tenant-a',
      label: 'Tenant A',
      issuer: A.issuer,
      clientId: 'ca',
      clientSecret: 'secret-a',
      hd: null,
    });
    expect(b?.clientSecret).toBe('secret-b');
    expect(b?.hd).toBe('practice.example');
    expect(ssoSecretName('tenant-a')).toBe('SSO_SECRET_TENANT_A');
  });

  it('fills the Google preset’s issuer and label, and an entry may override neither by omission', () => {
    const [google] = read(source([{ id: 'google', client_id: 'cg' }]));
    expect(google).toMatchObject({
      issuer: 'https://accounts.google.com',
      label: 'Google',
      clientSecret: 'g',
    });
    expect(detailOf(source([{ id: 'tenant-a', client_id: 'ca' }]))).toBe('SSO_PROVIDERS');
  });

  it.each([
    ['an http issuer', [{ ...A, issuer: 'http://idp-a.example/a/v2.0' }]],
    ['an issuer that is not a URL', [{ ...A, issuer: 'idp-a.example' }]],
    ['a repeated id', [A, { ...B, id: 'tenant-a' }]],
    ['a repeated issuer', [A, { ...B, issuer: A.issuer }]],
    ['an id with a capital', [{ ...A, id: 'Tenant-A' }]],
    ['an id of 25 characters', [{ ...A, id: 'a'.repeat(25) }]],
    ['a label of 41 characters', [{ ...A, label: 'x'.repeat(41) }]],
    ['no client id', [{ id: 'tenant-a', label: 'A', issuer: A.issuer }]],
    ['a key it does not know', [{ ...A, email_domains: ['practice.example'] }]],
    ['a Workspace domain that is not one', [{ ...A, hd: 'not a domain' }]],
    ['an entry that is not an object', ['tenant-a']],
    ['a list that is an object', { ...A }],
  ])('rejects %s, naming SSO_PROVIDERS', (_name, providers) => {
    expect(detailOf(source(providers))).toBe('SSO_PROVIDERS');
  });

  it('rejects text that is not JSON', () => {
    expect(detailOf(source('[{'))).toBe('SSO_PROVIDERS');
  });

  it('rejects a provider with no secret, or an empty one, naming that secret', () => {
    expect(detailOf(source([A], {}))).toBe('SSO_SECRET_TENANT_A');
    expect(detailOf(source([A], { SSO_SECRET_TENANT_A: ' ' }))).toBe('SSO_SECRET_TENANT_A');
    expect(detailOf(source([A, B], { SSO_SECRET_TENANT_A: 'x' }))).toBe('SSO_SECRET_TENANT_B');
  });
});
