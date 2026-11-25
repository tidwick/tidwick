// Agent fixtures: a grant with an access token minted straight into D1, as `just dev-agent-token` does, since the
// OAuth endpoints that mint one in production do not exist yet. And a caller for `/mcp` through the built Worker.
import { env, exports } from 'cloudflare:workers';
import { insertGrant, insertToken } from '../../src/db/agent-grants';
import { agentScopeFor, type Scope } from '../../src/db/scope';
import { newId } from '../../src/lib/ids';
import { currentEnv } from '../../src/lib/env';
import { keyedHash, randomToken, type HashKind } from '../../src/auth/tokens';
import { booking, WEEK, type Booking } from './booking';
import { ORIGIN } from './callers';

export interface Agent {
  readonly grantId: string;
  readonly personId: string;
  readonly token: string;
}

export interface AgentOptions {
  scopes?: readonly string[];
  clientName?: string;
  /** Milliseconds from now the access token lives; negative for one already expired. */
  life?: number;
  /** The hash kind the token is stored under; anything but `agent_access` must never authenticate. */
  kind?: HashKind;
  revoked?: boolean;
}

export const ALL_SCOPES = ['read', 'write', 'submit'] as const;

/** A grant for `personId` and its access token. */
export async function mintAgent(personId: string, options: AgentOptions = {}): Promise<Agent> {
  const now = Date.now();
  const grantId = newId();
  const token = randomToken();
  const hash = await keyedHash(currentEnv().SESSION_SECRET, options.kind ?? 'agent_access', token);
  await env.DB.batch([
    insertGrant(
      env.DB,
      {
        id: grantId,
        personId,
        clientId: 'https://client.example/metadata',
        clientName: options.clientName ?? 'Test agent',
        redirectUri: 'http://127.0.0.1/callback',
        scopes: options.scopes ?? ALL_SCOPES,
      },
      now,
    ),
    insertToken(env.DB, {
      hash,
      grantId,
      kind: 'access',
      expiresAt: now + (options.life ?? 60 * 60 * 1000),
    }),
  ]);
  if (options.revoked) {
    await env.DB.exec(`UPDATE agent_grant SET revoked_at = ${String(now)} WHERE id = '${grantId}'`);
  }
  return { grantId, personId, token };
}

/** The scope the `/mcp` route would build for a grant. */
export async function agentScope(agent: Agent): Promise<Scope> {
  return agentScopeFor(env.DB, {
    id: agent.grantId,
    person_id: agent.personId,
    client_name: 'Test agent',
  });
}

export interface McpResult {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

export interface McpOptions {
  headers?: Record<string, string>;
  /** Sent as the body as is; the default is the JSON of the message. */
  raw?: string;
  method?: string;
  origin?: string | null;
}

function parse(text: string): Record<string, unknown> {
  if (text === '') return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

/** POST a JSON-RPC message to `/mcp` with `token` as the bearer, or none for null. */
export async function mcp(
  token: string | null,
  message: unknown,
  options: McpOptions = {},
): Promise<McpResult> {
  const headers = new Headers({ 'content-type': 'application/json', ...options.headers });
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  const method = options.method ?? 'POST';
  const init: RequestInit = { method, headers };
  if (method !== 'GET') init.body = options.raw ?? JSON.stringify(message);
  const response = await exports.default.fetch(new Request(`${ORIGIN}/mcp`, init));
  const text = await response.text();
  const body = parse(text);
  return { status: response.status, headers: response.headers, body };
}

let serial = 0;

/** A 2025-era request: no version header, no envelope. */
export function rpc2025(method: string, params: unknown = {}) {
  serial += 1;
  return { jsonrpc: '2.0', id: serial, method, params };
}

export const MODERN = '2026-07-28';

/** A 2026-era request: the envelope in `_meta` and the headers that must match it. */
export function rpc2026(method: string, params: Record<string, unknown> = {}) {
  serial += 1;
  const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN };
  const message = { jsonrpc: '2.0', id: serial, method, params: { ...params, _meta: meta } };
  const name = typeof params.name === 'string' ? { 'mcp-name': params.name } : {};
  return {
    message,
    headers: { 'mcp-protocol-version': MODERN, 'mcp-method': method, ...name },
  };
}

/** `tools/call` in the 2025 era. */
export const call2025 = (name: string, args: Record<string, unknown> = {}) =>
  rpc2025('tools/call', { name, arguments: args });

export interface Called {
  status: number;
  isError: boolean;
  data: Record<string, unknown>;
  text: string;
}

/** A tool call through the 2025 era, its result's structured content and whether it was refused. */
export async function tool(
  agent: Agent,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Called> {
  const { status, body } = await mcp(agent.token, call2025(name, args));
  const result = (body.result ?? {}) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { text: string }[];
  };
  const text = result.content?.[0]?.text ?? '';
  const refused = result.isError === true;
  const data = refused
    ? (JSON.parse(text) as Record<string, unknown>)
    : (result.structuredContent ?? {});
  return { status, isError: refused, data, text };
}

export interface Setup {
  b: Booking;
  agent: Agent;
  rowId: string;
}

/** A member with an agent and one row in the week, added through the tool. */
export async function setup(): Promise<Setup> {
  const b = await booking();
  const agent = await mintAgent(b.who.personId);
  const task = b.tasks[0];
  const added = await tool(agent, 'add_row', {
    weekStart: WEEK,
    projectId: b.projectId,
    taskCodeId: task?.id,
  });
  const rows = added.data.rows as { rowId: string }[];
  return { b, agent, rowId: rows[0]?.rowId ?? '' };
}

/** Cells for `save_entries`: `[day, hours, note?]` for one row. */
export const cells = (rowId: string, ...days: [number, number | string, string?][]) =>
  days.map(([day, hours, note]) => ({
    rowId,
    day,
    hours,
    ...(note === undefined ? {} : { note }),
  }));
