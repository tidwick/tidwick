// Which revision of MCP a request speaks, and the refusal when its headers and body disagree. The body decides:
// a 2026-07-28 request names the revision in its `_meta` envelope and repeats it, the method and a tool's name
// in headers, which must match. Anything else with a known version header is the 2025 handshake era.
import { RPC, rpcError } from '../middleware/mcp-responses';

export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

export interface Message {
  jsonrpc: '2.0';
  id: string | number | null | undefined;
  method: string;
  params: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The JSON-RPC request or notification in a body, or the refusal for one that is not. */
export function readMessage(body: string): Message | Response {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return rpcError(null, RPC.parse, 'Parse error', 400);
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    return rpcError(null, RPC.invalidRequest, 'Invalid request', 400);
  }
  const { id, params } = parsed;
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') {
    return rpcError(null, RPC.invalidRequest, 'Invalid request', 400);
  }
  if (params !== undefined && !isRecord(params)) {
    return rpcError(id ?? null, RPC.invalidParams, 'Invalid params', 400);
  }
  return { jsonrpc: '2.0', id, method: parsed.method, params: params ?? {} };
}

const unsupported = (id: Message['id'], requested: unknown): Response =>
  rpcError(id ?? null, RPC.unsupportedVersion, 'Unsupported protocol version', 400, {
    supported: [MODERN_VERSION, ...LEGACY_VERSIONS],
    requested,
  });

const mismatch = (id: Message['id'], header: string): Response =>
  rpcError(id ?? null, RPC.headerMismatch, `Header mismatch: ${header}`, 400);

/** `modern` for a 2026 request, `legacy` for a 2025 one, or the refusal. */
export function classify(request: Request, message: Message): 'modern' | 'legacy' | Response {
  const meta = message.params._meta;
  const claim = isRecord(meta) ? meta[VERSION_KEY] : undefined;
  const header = request.headers.get('mcp-protocol-version');
  if (claim === undefined) {
    if (header === MODERN_VERSION) {
      return rpcError(message.id ?? null, RPC.invalidParams, `Missing _meta ${VERSION_KEY}`, 400);
    }
    if (header !== null && !LEGACY_VERSIONS.some((v) => v === header)) {
      return unsupported(message.id, header);
    }
    return request.headers.has('mcp-method') ? mismatch(message.id, 'Mcp-Method') : 'legacy';
  }
  if (claim !== MODERN_VERSION) return unsupported(message.id, claim);
  if (header !== claim) return mismatch(message.id, 'MCP-Protocol-Version');
  if (request.headers.get('mcp-method') !== message.method)
    return mismatch(message.id, 'Mcp-Method');
  const name = message.params.name;
  if (message.method === 'tools/call' && request.headers.get('mcp-name') !== name) {
    return mismatch(message.id, 'Mcp-Name');
  }
  return 'modern';
}
