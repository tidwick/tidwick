// The two discovery documents are public JSON, pinned by a golden file so a changed word is a reviewed diff, and the
// `/mcp` challenge points a client at them.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers/callers';

const get = (path: string) => exports.default.fetch(new Request(`${ORIGIN}${path}`));

describe('OAuth discovery', () => {
  it('matches the golden file', async () => {
    const docs = {
      protectedResource: await (await get('/.well-known/oauth-protected-resource')).json(),
      authorizationServer: await (await get('/.well-known/oauth-authorization-server')).json(),
    };
    await expect(`${JSON.stringify(docs, null, 2)}\n`).toMatchFileSnapshot(
      '../../test/golden/oauth-metadata.json',
    );
  });

  it('answers the /mcp suffix form with the same resource document, to a signed-out visitor', async () => {
    const plain = await get('/.well-known/oauth-protected-resource');
    const suffixed = await get('/.well-known/oauth-protected-resource/mcp');
    expect(suffixed.status).toBe(200);
    expect(suffixed.headers.get('content-type')).toContain('application/json');
    expect(await suffixed.json()).toEqual(await plain.json());
    expect((await get('/.well-known/oauth-protected-resource/other')).status).toBe(404);
  });

  it('names S256 as the only challenge method, no client authentication, and client ID metadata documents', async () => {
    const doc = await (
      await get('/.well-known/oauth-authorization-server')
    ).json<Record<string, unknown>>();
    expect(doc).toMatchObject({
      issuer: ORIGIN,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(doc.scopes_supported).toContain('offline_access');
  });
});
