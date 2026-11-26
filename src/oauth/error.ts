// What a refused OAuth request carries: an RFC 6749 error code and a sentence for the person or the client's log.
// The authorize page shows it as text and the token route renders it as JSON; neither ever redirects on it, so an
// address the server has not yet vetted is never sent anywhere.

export type OauthCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'invalid_target'
  | 'unsupported_grant_type';

export class OauthError extends Error {
  constructor(
    readonly error: OauthCode,
    message: string,
  ) {
    super(message);
    this.name = 'OauthError';
  }
}
