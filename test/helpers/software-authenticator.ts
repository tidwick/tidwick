import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;

type CborValue = number | string | Uint8Array | Map<number | string, CborValue>;

function cborHead(major: number, length: number): number[] {
  const type = major << 5;
  if (length < 24) return [type | length];
  if (length < 0x100) return [type | 24, length];
  if (length < 0x10000) return [type | 25, length >> 8, length & 0xff];
  return [
    type | 26,
    (length >>> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
}

function cbor(value: CborValue): number[] {
  if (typeof value === 'number') return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return [...cborHead(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...cborHead(2, value.length), ...value];
  const entries = [...value.entries()];
  return [...cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [...cbor(k), ...cbor(v)])];
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(parts.flatMap((part) => [...part]));
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function uint32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function derInteger(bytes: Uint8Array): number[] {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const body = [...bytes.slice(start)];
  if ((body[0] ?? 0) & 0x80) body.unshift(0);
  return [0x02, body.length, ...body];
}

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const body = [...derInteger(raw.slice(0, 32)), ...derInteger(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

export interface AssertTweaks {
  readonly userVerified?: boolean;
}

export interface SoftwareAuthenticator {
  readonly credentialId: string;
  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin: string,
  ): Promise<RegistrationResponseJSON>;
  assert(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
    tweaks?: AssertTweaks,
  ): Promise<AuthenticationResponseJSON>;
}

/**
 * A platform passkey held in memory: an ES256 key pair from WebCrypto, "none" attestation,
 * a discoverable credential that returns its user handle, and a counter that rises per assertion.
 */
export async function createSoftwareAuthenticator(): Promise<SoftwareAuthenticator> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const rawId = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = toBase64Url(rawId);
  let userHandle: string | undefined;
  let counter = 0;

  async function coseKey(): Promise<number[]> {
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    return cbor(
      new Map<number, CborValue>([
        [1, COSE_KTY_EC2],
        [3, COSE_ALG_ES256],
        [-1, COSE_CRV_P256],
        [-2, fromBase64Url(jwk.x ?? '')],
        [-3, fromBase64Url(jwk.y ?? '')],
      ]),
    );
  }

  return {
    credentialId,

    async register(options, origin) {
      userHandle = options.user.id;
      const rpId = options.rp.id ?? new URL(origin).hostname;
      const clientDataJSON = utf8(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: options.challenge,
          origin,
          crossOrigin: false,
        }),
      );
      const authData = concat(
        await sha256(utf8(rpId)),
        [FLAG_UP | FLAG_UV | FLAG_AT],
        uint32(counter),
        new Uint8Array(16),
        [rawId.length >> 8, rawId.length & 0xff],
        rawId,
        await coseKey(),
      );
      const attestationObject = cbor(
        new Map<string, CborValue>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          attestationObject: toBase64Url(new Uint8Array(attestationObject)),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },

    async assert(options, origin, tweaks = {}) {
      counter += 1;
      const rpId = options.rpId ?? new URL(origin).hostname;
      const clientDataJSON = utf8(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: options.challenge,
          origin,
          crossOrigin: false,
        }),
      );
      const flags = FLAG_UP | (tweaks.userVerified === false ? 0 : FLAG_UV);
      const authenticatorData = concat(await sha256(utf8(rpId)), [flags], uint32(counter));
      const signed = concat(authenticatorData, await sha256(clientDataJSON));
      const raw = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keys.privateKey,
        signed,
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: toBase64Url(clientDataJSON),
          authenticatorData: toBase64Url(authenticatorData),
          signature: toBase64Url(rawSignatureToDer(new Uint8Array(raw))),
          ...(userHandle === undefined ? {} : { userHandle }),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
