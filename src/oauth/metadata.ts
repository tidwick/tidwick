// The two discovery documents a client reads before it asks: what the resource is and who may grant access to it,
// and where this authorization server's endpoints are and what it supports. A golden test pins both, so a changed
// word is a reviewed diff.
import { audience, SCOPES_SUPPORTED } from './authorize';

export function protectedResource(origin: string): object {
  return {
    resource: audience(origin),
    authorization_servers: [origin],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_name: 'tidwick',
  };
}

export function authorizationServer(origin: string): object {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: SCOPES_SUPPORTED,
  };
}
