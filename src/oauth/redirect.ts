// Redirect addresses: which forms are allowed at all, how a requested one is matched to a client's listed ones, and
// which clients this server trusts. A hostile client document can claim any name, so trust rests on where the
// redirects lead and never on what the document calls itself.
import { OauthError } from './error';

/** Where hosted claude.ai sends the person back. */
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** An allowed redirect address: https, or http to this machine; never a fragment or credentials. */
export function parseRedirect(raw: string): URL | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.hash !== '' || url.username !== '' || url.password !== '') return null;
  if (url.protocol === 'https:') return url;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname) ? url : null;
}

/** An http address to this machine, which a program the person runs listens on at a port it picks. */
export function isLoopback(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}

/**
 * Whether a requested redirect is one the client listed. https addresses match exactly; a loopback one matches
 * with its port ignored, since the program picks a free port each run (RFC 8252). The caller stores the address the
 * client actually sent and holds the token request to that.
 */
export function isListed(requested: string, listed: readonly string[]): boolean {
  const want = parseRedirect(requested);
  if (!want) return false;
  return listed.some((entry) => {
    if (entry === requested) return true;
    const have = parseRedirect(entry);
    return (
      have !== null &&
      isLoopback(want) &&
      isLoopback(have) &&
      want.hostname === have.hostname &&
      want.pathname === have.pathname &&
      want.search === have.search
    );
  });
}

/**
 * The default policy: every listed redirect is claude.ai's callback or a loopback one, or starts with a prefix the
 * operator named in `MCP_CLIENTS`. Anything else is refused, so a document named "Claude" that sends the person's
 * code elsewhere is never offered for consent.
 */
export function requireTrusted(listed: readonly string[], prefixes: readonly string[]): void {
  for (const entry of listed) {
    const url = parseRedirect(entry);
    if (!url)
      throw new OauthError(
        'invalid_client',
        'The client lists a redirect address that is not allowed.',
      );
    const known =
      entry === CLAUDE_CALLBACK || isLoopback(url) || prefixes.some((p) => entry.startsWith(p));
    if (!known) throw new OauthError('invalid_client', 'This server does not accept that client.');
  }
}

/** Whether every listed redirect leads to this machine, which the consent page says so a person can weigh it. */
export function onlyLoopback(listed: readonly string[]): boolean {
  return listed.every((entry) => {
    const url = parseRedirect(entry);
    return url !== null && isLoopback(url);
  });
}
