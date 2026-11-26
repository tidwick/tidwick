// The 500 path: whatever a gate or page throws past the Actions' own boundary leaves as the catalog page or body,
// and the log line names the error without its message, cause or stack.
import type { MiddlewareNext } from 'astro';
import { ActionError } from 'astro:actions';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNTING } from '../../test/helpers/auth';
import { caller, rpc } from '../../test/helpers/callers';
import { refusalContext } from '../../test/helpers/refusal-context';
import { secrets } from '../../test/helpers/probe-secrets';
import { AppError, CATALOG } from '../lib/errors';
import { RPC_PATTERN } from './authz';
import { errors } from './errors';
import { MCP_PATTERN } from './mcp-responses';

async function answer(pattern: string, thrown: unknown): Promise<Response> {
  const context = refusalContext(pattern);
  const next: MiddlewareNext = () => {
    throw thrown;
  };
  const response = await errors(context, next);
  if (!(response instanceof Response)) return expect.unreachable('the boundary answers');
  return response;
}

describe('the error boundary', () => {
  it('a page or gate that throws answers the catalog 500 with no secret in its body, headers or log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [kind, secret] of Object.entries(secrets())) {
      for (const thrown of [new Error(secret), new Error('x', { cause: secret }), secret]) {
        for (const pattern of ['/week/[...start]', RPC_PATTERN]) {
          log.mockClear();
          const response = await answer(pattern, thrown);
          expect(response.status).toBe(500);
          const body = await response.text();
          expect(body).toContain(CATALOG.internal.message);
          expect(`${JSON.stringify([...response.headers])}${body}`, kind).not.toContain(secret);
          expect(log).toHaveBeenCalledTimes(1);
          expect(JSON.stringify(log.mock.calls), kind).not.toContain(secret);
        }
      }
    }
    log.mockRestore();
  });

  it('a catalog error keeps its status and code, and only a server-side one is logged, by name', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing = await answer('/week/[...start]', new AppError('missing_binding', 'NOTE_KEK'));
    expect(missing.status).toBe(500);
    expect(await missing.text()).toContain(CATALOG.missing_binding.message);
    expect(log.mock.calls).toEqual([['tidwick: request failed:', 'missing_binding: NOTE_KEK']]);
    log.mockClear();
    const refused = await answer(RPC_PATTERN, new AppError('forbidden', 'no route table row'));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      type: 'AstroActionError',
      code: 'FORBIDDEN',
      status: 403,
      error: 'forbidden',
      message: CATALOG.forbidden.message,
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('the error boundary on /mcp', () => {
  it('an uncaught throw leaves as a JSON-RPC internal error with no secret in it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [kind, secret] of Object.entries(secrets())) {
      const response = await answer(MCP_PATTERN, new Error(secret));
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: CATALOG.internal.message },
      });
      expect(`${JSON.stringify([...response.headers])}${body}`, kind).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls), kind).not.toContain(secret);
    }
    log.mockRestore();
  });
});

describe('a refusal of an /_actions/ call reaches the client as an Astro action error', () => {
  const parsed = async (response: Response) => ActionError.fromJson(await response.json());

  it('a call with no session, a stale step-up and a wrong token each carry the catalog message and status', async () => {
    const dead = await rpc('entries.save', null, { weekStart: '2026-01-05' });
    expect(dead.status).toBe(401);
    expect(await parsed(dead)).toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      message: CATALOG.unauthenticated.message,
    });
    const stale = await caller([ACCOUNTING], { stepUpAgo: 60 * 60 * 1000 });
    const aged = await rpc('entriesFor.save', stale, { weekStart: '2026-01-05' });
    expect(aged.status).toBe(403);
    expect(await parsed(aged)).toMatchObject({
      code: 'FORBIDDEN',
      message: CATALOG.step_up_required.message,
    });
    const forged = await rpc('entries.save', { ...stale, token: 'not-the-token' }, {});
    expect(await parsed(forged)).toMatchObject({
      code: 'FORBIDDEN',
      message: CATALOG.csrf.message,
    });
  });
});
