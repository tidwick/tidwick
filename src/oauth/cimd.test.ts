import { describe, expect, it } from 'vitest';
import { documentUrl } from './cimd';
import { OauthError } from './error';

const refused = (id: string, origin: string) => {
  try {
    documentUrl(id, origin);
  } catch (error) {
    return error instanceof OauthError;
  }
  return false;
};

describe('which client documents may be fetched', () => {
  const origin = 'https://tidwick.example';

  it('takes an https address with a path on port 443 and a host name', () => {
    expect(documentUrl('https://client.example/meta.json', origin).href).toBe(
      'https://client.example/meta.json',
    );
    expect(documentUrl('https://client.example:443/meta.json', origin).port).toBe('');
  });

  it('refuses http, another port, no path, credentials, a fragment, an IP literal, a bare host and this server', () => {
    for (const id of [
      'http://client.example/meta.json',
      'https://client.example:8443/meta.json',
      'https://client.example/',
      'https://u:p@client.example/meta.json',
      'https://client.example/meta.json#x',
      'https://192.0.2.1/meta.json',
      'https://2130706433/meta.json',
      'https://[2001:db8::1]/meta.json',
      'https://intranet/meta.json',
      'https://tidwick.example/meta.json',
      'file:///etc/passwd',
      'nonsense',
    ])
      expect(refused(id, origin), id).toBe(true);
  });

  it('fetches a loopback http document only when this server is itself on loopback http', () => {
    const local = 'http://localhost:4321';
    expect(documentUrl('http://127.0.0.1:9000/meta.json', local).port).toBe('9000');
    expect(refused('http://127.0.0.1:9000/meta.json', origin)).toBe(true);
    expect(refused('http://client.example/meta.json', local)).toBe(true);
  });
});
