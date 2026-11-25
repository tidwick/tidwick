// `/setup` in the built Worker. File order matters: the database starts empty, and the last case gives it history.
import type { APIContext } from 'astro';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { loadSeed } from '../../test/seed/load';
import { secrets } from '../../test/helpers/probe-secrets';
import { currentEnv } from '../lib/env';
import { AppError, CATALOG } from '../lib/errors';
import { errorPage } from './error-responses';
import { errors } from './errors';
import { setup, type SetupReport } from './setup';

const ADDRESS = 'https://timesheet.example';
const UNSET = { BACKUP_RECIPIENT: undefined, SESSION_SECRET: undefined, NOTE_KEK: undefined };
const source = (more: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...env,
  ORIGIN: ADDRESS,
  RP_ID: 'timesheet.example',
  ...UNSET,
  ...more,
});

function context(method = 'GET'): APIContext {
  const request = new Request(`${ADDRESS}/setup`, { method });
  return {
    routePattern: '/setup',
    request,
    url: new URL(request.url),
    locals: {},
  } as unknown as APIContext;
}

const reached = new Response('page');
const next = (): Promise<Response> => Promise.resolve(reached);

async function report(more?: Record<string, unknown>): Promise<SetupReport> {
  const c = context();
  expect(await setup(source(more))(c, next)).toBe(reached);
  return c.locals.setup as SetupReport;
}

async function refusal(run: () => unknown): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  return expect.unreachable('the gate let it through');
}

const failingDb = {
  prepare: () => {
    throw new Error('down');
  },
  batch: () => undefined,
};

describe('the setup gate', () => {
  it('SEC-47 an empty database with the three secrets unset reaches the page, naming BACKUP_RECIPIENT, SESSION_SECRET and NOTE_KEK and no value', async () => {
    const c = context();
    expect(await setup(source())(c, next)).toBe(reached);
    expect(c.locals.setup?.missing).toEqual(['BACKUP_RECIPIENT', 'SESSION_SECRET', 'NOTE_KEK']);
    expect(c.locals.session).toBeNull();
    const json = JSON.stringify(c.locals);
    for (const value of Object.values(secrets())) expect(json).not.toContain(value);
    expect(json).not.toContain(env.ORIGIN);
  });

  it('SEC-47 flags an ORIGIN that is not this address, MAIL_FROM on example.com and an unset off-account copy, and none once each is right', async () => {
    const wrong = await report({
      ORIGIN: 'https://elsewhere.example',
      MAIL_FROM: 'ops@example.com',
      BACKUP_COPY: 's3',
    });
    expect(wrong.flags).toEqual([
      `ORIGIN is not this address: set ORIGIN=${ADDRESS} and RP_ID=timesheet.example`,
      'MAIL_FROM is still the example sender: set your own, or MAIL=off',
      'off-account copy not set (BACKUP_S3_*)',
    ]);
    const right = await report({ MAIL_FROM: 'ops@firm.test', BACKUP_COPY: 'none' });
    expect(right.flags).toEqual([]);
  });

  it('SEC-47 a missing DB binding, or one whose read fails, keeps the old missing_binding error', async () => {
    const none = await refusal(() => setup(source({ DB: undefined }))(context(), next));
    expect([none.code, none.detail]).toEqual(['missing_binding', 'DB']);
    const down = await refusal(() => setup(source({ DB: failingDb }))(context(), next));
    expect([down.code, down.detail]).toEqual(['missing_binding', 'BACKUP_RECIPIENT']);
  });

  it('SEC-47 a configured Worker answers 404 on /setup, and a POST is refused', async () => {
    const got = await exports.default.fetch(new Request(`${ADDRESS}/setup`));
    expect(got.status).toBe(404);
    expect(await got.text()).toBe(await errorPage('not_found').text());
    const posted = await exports.default.fetch(
      new Request(`${ADDRESS}/setup`, { method: 'POST', body: '{}' }),
    );
    expect(posted.status).toBe(403);
  });

  it('SEC-47 the old error is unchanged: same status, page and log line', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gate = setup(source({ DB: failingDb }));
    const c = context();
    const response = await errors(c, async () => (await gate(c, next)) as Response);
    expect(response instanceof Response && response.status).toBe(CATALOG.missing_binding.status);
    expect(await (response as Response).text()).toBe(await errorPage('missing_binding').text());
    expect(log).toHaveBeenCalledWith(
      'tidwick: request failed:',
      'missing_binding: BACKUP_RECIPIENT',
    );
    log.mockRestore();
  });

  it('SEC-47 once the database has history, a missing secret gives the old error, never the page', async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
    const c = context();
    const error = await refusal(() => setup(source())(c, next));
    expect([error.code, error.detail]).toEqual(['missing_binding', 'BACKUP_RECIPIENT']);
    expect(c.locals.setup).toBeUndefined();
  });
});
