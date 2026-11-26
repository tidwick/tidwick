// `/mcp`: one stateless JSON-RPC route. A bearer finds the grant, the agent's scope is built fresh from it, and each
// tool call passes the same route-table gate a person's would, as a principal with no grants and no step-up.
import { version } from '../../package.json';
import { bearerOf, verifyAccess } from '../auth/agent-tokens';
import { throttleAgent } from '../auth/rate-limit';
import type { Session } from '../auth/session';
import { touchGrant, type GrantRow } from '../db/agent-grants';
import { agentScopeFor } from '../db/scope';
import { currentEnv, noteKeks, type Env } from '../lib/env';
import { errorText } from '../lib/error-text';
import { isAppError } from '../lib/errors';
import {
  accepted,
  bearerRefusal,
  notAllowed,
  rpcRefusal,
  RPC,
  rpcError,
  rpcResult,
  toolRefusal,
  toolResult,
  type RpcId,
} from '../middleware/mcp-responses';
import { authorize } from '../middleware/authz';
import { TOOLS, toolRule, type ToolName, type ToolScope } from '../routes';
import { INSTRUCTIONS } from './schemas';
import { IMPLS } from './tools';
import { classify, LEGACY_VERSIONS, MODERN_VERSION, readMessage, type Message } from './protocol';

const SERVER = { name: 'tidwick', title: 'tidwick timesheet', version } as const;

/** The per-result `_meta` key a 2026 server names itself under; the tool list is the same for everyone and changes only on a deploy. */
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
const CACHE = { ttlMs: 60_000, cacheScope: 'private' } as const;

/** A 2026 result: complete, naming the server and, where it is cacheable, how long and for whom. */
const modern = (id: RpcId, result: object, cacheable = false): Response =>
  rpcResult(id, {
    resultType: 'complete',
    ...(cacheable ? CACHE : {}),
    ...result,
    _meta: { [SERVER_INFO]: SERVER },
  });

const isTool = (name: unknown): name is ToolName =>
  typeof name === 'string' && Object.hasOwn(TOOLS, name);

/** The tools as `tools/list` shows them, the same for every caller. */
export function toolList() {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({ name, ...listed(name) }));
}

function listed(name: ToolName) {
  const { title, description, annotations, inputSchema, outputSchema } = IMPLS[name];
  return { title, description, inputSchema, outputSchema, annotations };
}

/** A person with a member's rights and nothing more: no grants, and a step-up stamp of 0 that no row accepts. */
export const agentPrincipal = (personId: string): Session => ({
  rawId: '',
  personId,
  name: '',
  mustEnrol: false,
  stepUpAt: 0,
});

function scopesOf(grant: GrantRow): readonly ToolScope[] {
  try {
    const parsed: unknown = JSON.parse(grant.scopes);
    return Array.isArray(parsed) ? (parsed as ToolScope[]) : [];
  } catch {
    return [];
  }
}

/**
 * The one door every tool passes: its route-table row (the Action's, or the page's GET) judged for the agent's
 * principal. Throws the catalog error that refuses it, so a tool wired to anything above a member's rights never runs.
 */
export function gateTool(name: ToolName, personId: string, now: number): void {
  authorize(toolRule(name), agentPrincipal(personId), [], now);
}

async function callTool(
  env: Env,
  grant: GrantRow,
  message: Message,
  era: 'modern' | 'legacy',
): Promise<Response> {
  const { name, arguments: input } = message.params;
  const id = message.id ?? null;
  if (!isTool(name)) return rpcError(id, RPC.invalidParams, 'Unknown tool');
  const needs = TOOLS[name].scope;
  if (!scopesOf(grant).includes(needs)) return bearerRefusal('insufficient_scope', needs, id);
  const now = Date.now();
  try {
    gateTool(name, grant.person_id, now);
    await throttleAgent(env.RATE_LIMIT, env.SESSION_SECRET, { person: grant.person_id });
    const scope = await agentScopeFor(env.DB, grant);
    await touchGrant(env.DB, grant.id, now);
    const context = {
      scope,
      db: env.DB,
      keks: noteKeks(env),
      notes: env.MCP_NOTES,
      secret: env.SESSION_SECRET,
      personId: grant.person_id,
      grantId: grant.id,
      now,
    };
    const result = toolResult(await IMPLS[name].call(context, input));
    return era === 'modern' ? modern(id, result) : rpcResult(id, result);
  } catch (error) {
    if (isAppError(error) && error.status < 500) {
      const refusal = toolRefusal(error.code, error.detail);
      return era === 'modern' ? modern(id, refusal) : rpcResult(id, refusal);
    }
    console.error('tidwick: tool failed:', errorText(error));
    return rpcError(id, RPC.internal, 'Internal error', 500);
  }
}

function initialize(message: Message): Response {
  const asked = message.params.protocolVersion;
  return rpcResult(message.id ?? null, {
    protocolVersion: LEGACY_VERSIONS.find((v) => v === asked) ?? LEGACY_VERSIONS[0],
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER,
    instructions: INSTRUCTIONS,
  });
}

/** What a 2026 client asks first, in place of a handshake: the versions served and what the server offers. */
function discover(id: RpcId): Response {
  return modern(
    id,
    {
      supportedVersions: [MODERN_VERSION, ...LEGACY_VERSIONS],
      capabilities: { tools: { listChanged: false } },
      instructions: INSTRUCTIONS,
    },
    true,
  );
}

/** Answers one `/mcp` request; MCP off is a 404 and a GET is a 405, both before any token is read. */
export async function handleMcp(request: Request): Promise<Response> {
  const env = currentEnv();
  if (!env.MCP) return rpcRefusal('not_found');
  if (request.method !== 'POST') return notAllowed();
  const header = request.headers.get('authorization');
  const token = bearerOf(header);
  if (token === null) return bearerRefusal(header === null ? 'missing_token' : 'invalid_token');
  const grant = await verifyAccess(env.DB, env.SESSION_SECRET, token, Date.now());
  if (grant === null) {
    // A failed lookup counts against the address; past the limit a guess gets a 429, not another 401.
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    try {
      await throttleAgent(env.RATE_LIMIT, env.SESSION_SECRET, { ip });
    } catch (error) {
      if (isAppError(error, 'rate_limited')) return rpcRefusal('rate_limited');
      throw error;
    }
    return bearerRefusal('invalid_token');
  }
  const message = readMessage(await request.text());
  if (message instanceof Response) return message;
  const era = classify(request, message);
  if (era instanceof Response) return era;
  const id: RpcId = message.id ?? null;
  if (message.id === undefined) return accepted();
  switch (message.method) {
    case 'initialize':
      return era === 'legacy'
        ? initialize(message)
        : rpcError(id, RPC.methodNotFound, 'Method not found');
    case 'server/discover':
      return era === 'modern' ? discover(id) : rpcError(id, RPC.methodNotFound, 'Method not found');
    case 'ping':
      return era === 'modern' ? modern(id, {}) : rpcResult(id, {});
    case 'tools/list':
      return era === 'modern'
        ? modern(id, { tools: toolList() }, true)
        : rpcResult(id, { tools: toolList() });
    case 'tools/call':
      return callTool(env, grant, message, era);
    default:
      return rpcError(id, RPC.methodNotFound, 'Method not found');
  }
}
