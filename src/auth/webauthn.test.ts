import { describe, expect, it } from 'vitest';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  createSoftwareAuthenticator,
  fromBase64Url,
  toBase64Url,
} from '../../test/helpers/software-authenticator';
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type RelyingParty,
} from './webauthn';

const rp: RelyingParty = {
  id: 'timesheet.example',
  name: 'Example timesheet',
  origin: 'https://timesheet.example',
};
const user = {
  id: new Uint8Array(16).fill(7),
  name: 'pat@firm.example',
  displayName: 'Pat Example',
};

async function enrolled() {
  const authenticator = await createSoftwareAuthenticator();
  const creation = await registrationOptions(rp, user);
  const registration = await authenticator.register(creation, rp.origin);
  const credential = await verifyRegistration(rp, registration, creation.challenge);
  if (credential === null) return expect.unreachable('registration must verify');
  return { authenticator, credential };
}

function withSignatureByteFlipped(
  response: AuthenticationResponseJSON,
): AuthenticationResponseJSON {
  const signature = fromBase64Url(response.response.signature);
  signature[signature.length - 1] = (signature[signature.length - 1] ?? 0) ^ 0x01;
  return { ...response, response: { ...response.response, signature: toBase64Url(signature) } };
}

function withClientData(
  response: RegistrationResponseJSON,
  field: string,
  value: string,
): RegistrationResponseJSON {
  const clientData = JSON.parse(
    new TextDecoder().decode(fromBase64Url(response.response.clientDataJSON)),
  ) as object;
  const forged = new TextEncoder().encode(JSON.stringify({ ...clientData, [field]: value }));
  return { ...response, response: { ...response.response, clientDataJSON: toBase64Url(forged) } };
}

describe('SEC-01 passkey responses are verified for origin, RP ID and signature on Workers', () => {
  it('runs inside the Workers runtime', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
  });

  it('a software passkey registers and then asserts, and both verify', async () => {
    const { authenticator, credential } = await enrolled();
    expect(credential.id).toBe(authenticator.credentialId);

    const request = await authenticationOptions(rp);
    const assertion = await authenticator.assert(request, rp.origin);
    const result = await verifyAuthentication(rp, assertion, request.challenge, credential);
    expect(result).toEqual({ newCounter: 1 });
  });

  it('an assertion with a tampered signature fails verification', async () => {
    const { authenticator, credential } = await enrolled();
    const request = await authenticationOptions(rp);
    const assertion = await authenticator.assert(request, rp.origin);
    const result = await verifyAuthentication(
      rp,
      withSignatureByteFlipped(assertion),
      request.challenge,
      credential,
    );
    expect(result).toBeNull();
  });

  it('an assertion made for another origin fails verification', async () => {
    const { authenticator, credential } = await enrolled();
    const request = await authenticationOptions(rp);
    const assertion = await authenticator.assert(request, 'https://phish.example');
    expect(await verifyAuthentication(rp, assertion, request.challenge, credential)).toBeNull();
  });

  it('an assertion scoped to another RP ID fails verification', async () => {
    const { authenticator, credential } = await enrolled();
    const request = await authenticationOptions({ ...rp, id: 'phish.example' });
    const assertion = await authenticator.assert(request, rp.origin);
    expect(await verifyAuthentication(rp, assertion, request.challenge, credential)).toBeNull();
  });

  it('an assertion answering a different challenge fails verification', async () => {
    const { authenticator, credential } = await enrolled();
    const request = await authenticationOptions(rp);
    const other = await authenticationOptions(rp);
    const assertion = await authenticator.assert(request, rp.origin);
    expect(await verifyAuthentication(rp, assertion, other.challenge, credential)).toBeNull();
  });

  it('an assertion without user verification fails verification', async () => {
    const { authenticator, credential } = await enrolled();
    const request = await authenticationOptions(rp);
    const assertion = await authenticator.assert(request, rp.origin, { userVerified: false });
    expect(await verifyAuthentication(rp, assertion, request.challenge, credential)).toBeNull();
  });

  it('a registration whose client data names another origin or challenge fails verification', async () => {
    const authenticator = await createSoftwareAuthenticator();
    const creation = await registrationOptions(rp, user);
    const registration = await authenticator.register(creation, rp.origin);
    const forgedOrigin = withClientData(registration, 'origin', 'https://phish.example');
    const forgedChallenge = withClientData(
      registration,
      'challenge',
      toBase64Url(new Uint8Array(32)),
    );
    expect(await verifyRegistration(rp, forgedOrigin, creation.challenge)).toBeNull();
    expect(await verifyRegistration(rp, forgedChallenge, creation.challenge)).toBeNull();
  });
});
