// The edge renderer for MCP: catalog errors as JSON-RPC errors or tool results, and a refused bearer as RFC 6750.
// Beside the catalog's other renderers (error-responses.ts); the catalog itself gains no text for it.
import { CATALOG, errorMessage, type ErrorCode } from '../lib/errors';

/** JSON-RPC and MCP protocol error codes this server answers with. */
export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

/** The route pattern of the one agent route. */
export const MCP_PATTERN = '/mcp';

export type RpcId = string | number | null;

/** A JSON-RPC success; the id is the request's. */
export function rpcResult(id: RpcId, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}

/** A JSON-RPC error, on the HTTP status the transport wants for it. */
export function rpcError(
  id: RpcId,
  code: number,
  message: string,
  status = 200,
  data?: unknown,
): Response {
  const error = data === undefined ? { code, message } : { code, message, data };
  return Response.json({ jsonrpc: '2.0', id, error }, { status });
}

/** A notification is accepted and answered with nothing. */
export const accepted = (): Response => new Response(null, { status: 202 });

/** `/mcp` takes a POST only: this server holds no stream for a GET to open. */
export const notAllowed = (): Response =>
  new Response(null, { status: 405, headers: { allow: 'POST' } });

/** What a refused request on `/mcp` renders as, before any tool runs: a catalog code as JSON-RPC. */
export function rpcRefusal(code: ErrorCode, status = CATALOG[code].status): Response {
  return rpcError(null, RPC.invalidRequest, CATALOG[code].message, status);
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** A tool's result: the data as typed JSON in `structuredContent`, and the same as text for clients that read only text. */
export function toolResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** A domain refusal (`locked`, `day_cap`, `forbidden`, bad input) as a tool result the model reads and acts on. */
export function toolRefusal(code: ErrorCode, detail?: string): ToolResult {
  const body = { error: code, message: errorMessage(code, detail) };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
}

/**
 * A bearer refused, as JSON-RPC with RFC 6750's challenge in the header: 401 for a missing, unknown, expired or
 * revoked token, 403 naming the scope the tool needs. `data.error` is the RFC 6750 code; a missing token carries none.
 */
export function bearerRefusal(
  error: 'missing_token' | 'invalid_token' | 'insufficient_scope',
  scope?: string,
  id: RpcId = null,
): Response {
  const forbidden = error === 'insufficient_scope';
  const code: ErrorCode = forbidden ? 'forbidden' : 'unauthenticated';
  const challenge = ['Bearer realm="tidwick"'];
  if (error !== 'missing_token') challenge.push(`error="${error}"`);
  if (scope !== undefined) challenge.push(`scope="${scope}"`);
  const response = rpcError(
    id,
    RPC.invalidRequest,
    CATALOG[code].message,
    CATALOG[code].status,
    error === 'missing_token' ? undefined : scope === undefined ? { error } : { error, scope },
  );
  response.headers.set('www-authenticate', challenge.join(', '));
  return response;
}
