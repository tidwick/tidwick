import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { COPY_NAMES, readEnv, setupEnv } from './env';
import { AppError } from './errors';

function complete(): Record<string, unknown> {
  return {
    DB: env.DB,
    BACKUPS: env.BACKUPS,
    RATE_LIMIT: env.RATE_LIMIT,
    LOGIN_LIMIT: env.LOGIN_LIMIT,
    EMAIL: env.EMAIL,
    ORIGIN: 'http://localhost:4321',
    RP_ID: 'localhost',
    MAIL_FROM: 'tidwick@example.com',
    BACKUP_RECIPIENT: readEnv(env).BACKUP_RECIPIENT,
    SESSION_SECRET: 'dummy-session-secret-for-tests-only-not-real',
    NOTE_KEK: 'ZHVtbXktbm90ZS1rZWstZm9yLXRlc3RzLW9ubHktMzI=',
    NOTE_KEK_PREVIOUS: '',
    SETUP_TOKEN: '',
  };
}

/** Vars a local run may set in .dev.vars that wrangler.jsonc sets only for the demo environment. */
const LOCAL_SWITCHES = ['DEMO_BANNER', 'SSO_PROVIDERS'];

function caught(source: object): AppError {
  try {
    readEnv(source);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  return expect.unreachable('readEnv accepted an incomplete env');
}

describe('typed env', () => {
  it('parses a complete env into typed bindings and reuses the result', () => {
    const source = complete();
    const parsed = readEnv(source);
    expect(parsed.DB).toBe(env.DB);
    expect(parsed.ORIGIN).toBe('http://localhost:4321');
    expect(readEnv(source)).toBe(parsed);
  });

  it.each([
    'DB',
    'RATE_LIMIT',
    'LOGIN_LIMIT',
    'EMAIL',
    'ORIGIN',
    'RP_ID',
    'MAIL_FROM',
    'BACKUP_RECIPIENT',
    'SESSION_SECRET',
    'NOTE_KEK',
  ])('a missing %s is rejected with a catalog error naming it', (name) => {
    const source = Object.fromEntries(Object.entries(complete()).filter(([key]) => key !== name));
    const error = caught(source);
    expect(error.code).toBe('missing_binding');
    expect(error.detail).toBe(name);
    expect(error.message).toContain(name);
  });

  it('needs no BACKUPS bucket: the demo Worker has none and no request reads it', () => {
    const demo = Object.fromEntries(
      Object.entries(complete()).filter(([key]) => key !== 'BACKUPS'),
    );
    expect(readEnv(demo).DB).toBe(env.DB);
  });

  it('a binding of the wrong kind and a malformed origin are rejected by name', () => {
    expect(caught({ ...complete(), DB: env.BACKUPS }).detail).toBe('DB');
    expect(caught({ ...complete(), ORIGIN: 'http://localhost:4321/path' }).detail).toBe('ORIGIN');
    expect(caught({ ...complete(), SESSION_SECRET: '  ' }).detail).toBe('SESSION_SECRET');
    expect(caught({ ...complete(), MAIL_FROM: 'tidwick' }).detail).toBe('MAIL_FROM');
    expect(caught({ ...complete(), BACKUP_RECIPIENT: 'AGE-SECRET-KEY-1' }).detail).toBe(
      'BACKUP_RECIPIENT',
    );
  });

  it('a NOTE_KEK that is not standard base64 of 32 bytes, or a SESSION_SECRET under 32 bytes, is missing_binding naming it', () => {
    expect(readEnv(complete()).NOTE_KEK).toBe('ZHVtbXktbm90ZS1rZWstZm9yLXRlc3RzLW9ubHktMzI=');
    for (const NOTE_KEK of [
      'c2l4dGVlbi1ieXRlLWtleQ==',
      '-vv8_f7_-vv8_f7_-vv8_f7_-vv8_f7_-vv8_f7_-_8=',
      'ZHVtbXktbm90ZS1rZWstZm9yLXRlc3RzLW9ubHktMzI',
      'not base64 at all',
    ]) {
      expect(caught({ ...complete(), NOTE_KEK }).detail).toBe('NOTE_KEK');
    }
    for (const SESSION_SECRET of ['eHh4eHh4eHh4eHh4eHh4eA', 'a'.repeat(42)]) {
      expect(caught({ ...complete(), SESSION_SECRET }).detail).toBe('SESSION_SECRET');
    }
  });

  it('NOTE_KEK_PREVIOUS reads as null when unset or empty, and a set one must have the NOTE_KEK shape', () => {
    const unset = Object.fromEntries(
      Object.entries(complete()).filter(([key]) => key !== 'NOTE_KEK_PREVIOUS'),
    );
    expect(readEnv(unset).NOTE_KEK_PREVIOUS).toBeNull();
    expect(readEnv(complete()).NOTE_KEK_PREVIOUS).toBeNull();
    const previous = 'cHJldmlvdXMtbm90ZS1rZWstZm9yLXRlc3RzLW9ubHk=';
    expect(readEnv({ ...complete(), NOTE_KEK_PREVIOUS: previous }).NOTE_KEK_PREVIOUS).toBe(
      previous,
    );
    for (const NOTE_KEK_PREVIOUS of ['c2l4dGVlbi1ieXRlLWtleQ==', '   ', 'not base64 at all']) {
      expect(caught({ ...complete(), NOTE_KEK_PREVIOUS }).detail).toBe('NOTE_KEK_PREVIOUS');
    }
  });

  it('with MAIL off the env needs no EMAIL binding or MAIL_FROM and reads both as null; mail is on by default', () => {
    const rest = Object.fromEntries(
      Object.entries(complete()).filter(([key]) => key !== 'EMAIL' && key !== 'MAIL_FROM'),
    );
    const off = readEnv({ ...rest, MAIL: 'off' });
    expect(off.EMAIL).toBeNull();
    expect(off.MAIL_FROM).toBeNull();
    expect(readEnv({ ...complete(), MAIL: 'off' }).EMAIL).toBeNull();
    expect(readEnv(complete()).EMAIL).toBe(env.EMAIL);
    expect(readEnv({ ...complete(), MAIL: 'on' }).MAIL_FROM).toBe('tidwick@example.com');
    expect(caught(rest).detail).toBe('EMAIL');
    expect(caught({ ...rest, MAIL: 'on' }).detail).toBe('EMAIL');
    for (const MAIL of ['', 'OFF', 'no', 'false']) {
      expect(caught({ ...complete(), MAIL }).detail).toBe('MAIL');
    }
  });

  it('the demo banner flag is off by default: unset or empty reads false, only "on" turns it on', () => {
    expect(readEnv(complete()).DEMO_BANNER).toBe(false);
    expect(readEnv({ ...complete(), DEMO_BANNER: '' }).DEMO_BANNER).toBe(false);
    expect(readEnv({ ...complete(), DEMO_BANNER: 'on' }).DEMO_BANNER).toBe(true);
    for (const DEMO_BANNER of ['ON', 'true', '1', 'off']) {
      expect(caught({ ...complete(), DEMO_BANNER }).detail).toBe('DEMO_BANNER');
    }
    expect(env).not.toHaveProperty('DEMO_BANNER');
  });

  it('SSO is off by default and, when set, needs each provider’s secret', () => {
    expect(readEnv(complete()).SSO).toEqual([]);
    expect(readEnv({ ...complete(), SSO_PROVIDERS: '' }).SSO).toEqual([]);
    const providers = JSON.stringify([{ id: 'google', client_id: 'cg' }]);
    expect(caught({ ...complete(), SSO_PROVIDERS: providers }).detail).toBe('SSO_SECRET_GOOGLE');
    const on = readEnv({ ...complete(), SSO_PROVIDERS: providers, SSO_SECRET_GOOGLE: 's' });
    expect(on.SSO.map((p) => p.id)).toEqual(['google']);
  });

  it('SETUP_TOKEN reads null when unset or under 43 characters, and never throws', () => {
    const long = 'x'.repeat(43);
    expect(readEnv({ ...complete(), SETUP_TOKEN: long }).SETUP_TOKEN).toBe(long);
    expect(readEnv({ ...complete(), SETUP_TOKEN: ` ${long}\n` }).SETUP_TOKEN).toBe(long);
    for (const value of [undefined, '', 'short', 'x'.repeat(42), 7]) {
      expect(readEnv({ ...complete(), SETUP_TOKEN: value }).SETUP_TOKEN).toBeNull();
    }
  });

  it('.dev.vars.example names every secret the env and the backup read that wrangler.jsonc does not set, each with no value', () => {
    const files = import.meta.glob<string>(['../../.dev.vars.example', '../../wrangler.jsonc'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const example = files['../../.dev.vars.example'] ?? '';
    const wrangler = files['../../wrangler.jsonc'] ?? '';
    const assignments = example.split('\n').filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line));
    expect(assignments.filter((line) => !line.endsWith('='))).toEqual([]);
    const named = assignments.map((line) => line.slice(0, -1)).toSorted();
    const strings = Object.entries(complete()).filter(([, value]) => typeof value === 'string');
    const read = [...strings.map(([name]) => name), ...COPY_NAMES];
    const secrets = read.filter((name) => !wrangler.includes(`"${name}"`));
    expect(named).toEqual([...secrets, ...LOCAL_SWITCHES].toSorted());
  });

  it('setupEnv is null for a complete env and otherwise names every refused binding in parse order, never a value', () => {
    expect(setupEnv(complete())).toBeNull();
    const source = {
      ...complete(),
      RP_ID: undefined,
      NOTE_KEK: 'not-a-kek',
      SESSION_SECRET: undefined,
    };
    const found = setupEnv(source);
    expect(found?.missing).toEqual(['RP_ID', 'SESSION_SECRET', 'NOTE_KEK']);
    expect(JSON.stringify(found)).not.toContain('not-a-kek');
  });
});
