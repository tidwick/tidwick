import { describe, expect, it } from 'vitest';
import { OauthError } from './error';
import { CLAUDE_CALLBACK, isListed, onlyLoopback, parseRedirect, requireTrusted } from './redirect';

describe('redirect addresses', () => {
  it('allows https and http to this machine, and nothing else', () => {
    for (const ok of [
      CLAUDE_CALLBACK,
      'https://app.example/cb?x=1',
      'http://localhost:8080/cb',
      'http://127.0.0.1/cb',
      'http://[::1]:9/cb',
    ])
      expect(parseRedirect(ok), ok).not.toBeNull();
    for (const bad of [
      'http://app.example/cb',
      'ftp://app.example/cb',
      'javascript:alert(1)',
      'https://app.example/cb#frag',
      'https://user:pw@app.example/cb',
      'http://127.0.0.2/cb',
      'cursor://callback',
      'not a url',
    ])
      expect(parseRedirect(bad), bad).toBeNull();
  });

  it('matches https exactly and loopback with the port ignored, host and path held', () => {
    expect(isListed(CLAUDE_CALLBACK, [CLAUDE_CALLBACK])).toBe(true);
    expect(isListed(`${CLAUDE_CALLBACK}/`, [CLAUDE_CALLBACK])).toBe(false);
    expect(isListed('https://claude.ai:444/api/mcp/auth_callback', [CLAUDE_CALLBACK])).toBe(false);
    expect(isListed('http://127.0.0.1:5000/cb', ['http://127.0.0.1/cb'])).toBe(true);
    expect(isListed('http://127.0.0.1:5000/cb', ['http://127.0.0.1:6000/cb'])).toBe(true);
    expect(isListed('http://[::1]:5000/cb', ['http://[::1]/cb'])).toBe(true);
    expect(isListed('http://localhost:5000/cb', ['http://127.0.0.1/cb'])).toBe(false);
    expect(isListed('http://127.0.0.1:5000/cb/', ['http://127.0.0.1/cb'])).toBe(false);
    expect(isListed('https://127.0.0.1:5000/cb', ['https://127.0.0.1/cb'])).toBe(false);
  });

  it('trusts claude.ai, this machine and the operator’s prefixes, and no other host', () => {
    const refused = (listed: string[], prefixes: string[] = []) => {
      try {
        requireTrusted(listed, prefixes);
      } catch (error) {
        return error instanceof OauthError ? error.error : 'other';
      }
      return null;
    };
    expect(refused([CLAUDE_CALLBACK, 'http://127.0.0.1/cb'])).toBeNull();
    expect(refused(['https://app.example/cb'])).toBe('invalid_client');
    expect(refused([CLAUDE_CALLBACK, 'https://app.example/cb'])).toBe('invalid_client');
    expect(refused(['https://app.example/cb'], ['https://app.example/'])).toBeNull();
    expect(refused(['https://app.example.evil.example/cb'], ['https://app.example/'])).toBe(
      'invalid_client',
    );
    expect(refused(['https://claude.ai.evil.example/api/mcp/auth_callback'])).toBe(
      'invalid_client',
    );
    expect(onlyLoopback(['http://127.0.0.1/cb', 'http://localhost/cb'])).toBe(true);
    expect(onlyLoopback(['http://127.0.0.1/cb', CLAUDE_CALLBACK])).toBe(false);
  });
});
