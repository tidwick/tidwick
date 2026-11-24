import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';

export interface RelyingParty {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
}

export interface PasskeyUser {
  readonly id: Uint8Array<ArrayBuffer>;
  readonly name: string;
  readonly displayName: string;
}

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
};

export function registrationOptions(
  rp: RelyingParty,
  user: PasskeyUser,
  existing: readonly WebAuthnCredential[] = [],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userID: user.id,
    userName: user.name,
    userDisplayName: user.displayName,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      ...(c.transports ? { transports: c.transports } : {}),
    })),
  });
}

export function authenticationOptions(
  rp: RelyingParty,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'required',
    allowCredentials: [],
  });
}

/** Returns the new credential, or null for any response that does not verify, thrown or not. */
export async function verifyRegistration(
  rp: RelyingParty,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<WebAuthnCredential | null> {
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
    return result.verified ? result.registrationInfo.credential : null;
  } catch {
    return null;
  }
}

/** Returns the counter to store, or null for any assertion that does not verify, thrown or not. */
export async function verifyAuthentication(
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: WebAuthnCredential,
): Promise<{ newCounter: number } | null> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential,
      requireUserVerification: true,
    });
    return result.verified ? { newCounter: result.authenticationInfo.newCounter } : null;
  } catch {
    return null;
  }
}
