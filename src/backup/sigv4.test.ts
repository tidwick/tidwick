// The signer against the worked examples AWS publishes for S3 in the S3 API Reference ("Signature calculations
// for the Authorization header: transferring payload in a single chunk"); `sigv4-suite.test.ts` holds the cases
// from the general Signature Version 4 test suite.
import { describe, expect, it } from 'vitest';
import { amzDate, s3Headers, sha256Hex, sign, uriEncode, type SigV4Key } from './sigv4';

const S3_KEY: SigV4Key = {
  keyId: 'AKIAIOSFODNN7EXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const BUCKET = 'examplebucket.s3.amazonaws.com';
const S3_AT = { host: BUCKET, 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY };
const UNRESERVED = '-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const WELCOME = 'Welcome to Amazon S3.';
const WELCOME_HASH = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072';

const PUT_OBJECT = {
  method: 'PUT',
  url: `https://${BUCKET}/test$file.text`,
  headers: {
    Host: BUCKET,
    Date: 'Fri, 24 May 2013 00:00:00 GMT',
    'x-amz-date': '20130524T000000Z ',
    'x-amz-storage-class': 'REDUCED_REDUNDANCY',
    'x-amz-content-sha256': WELCOME_HASH,
  },
  payloadHash: WELCOME_HASH,
};

interface Example {
  method: string;
  url: string;
  headers: Record<string, string>;
  payloadHash: string;
  signature: string;
}

const EXAMPLES: Record<string, Example> = {
  'GET Object with a range': {
    method: 'GET',
    url: `https://${BUCKET}/test.txt`,
    headers: { ...S3_AT, Range: 'bytes=0-9' },
    payloadHash: EMPTY,
    signature: 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  },
  'PUT Object': {
    ...PUT_OBJECT,
    signature: '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
  },
  'GET Bucket lifecycle': {
    method: 'GET',
    url: `https://${BUCKET}/?lifecycle`,
    headers: S3_AT,
    payloadHash: EMPTY,
    signature: 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543',
  },
  'GET Bucket list': {
    method: 'GET',
    url: `https://${BUCKET}/?max-keys=2&prefix=J`,
    headers: S3_AT,
    payloadHash: EMPTY,
    signature: '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
  },
};

describe('SEC-15 the SigV4 signer', () => {
  it.each(Object.entries(EXAMPLES))(
    'SEC-15 reproduces the published signature for the S3 example %s',
    async (_name, { signature, ...request }) => {
      expect((await sign(S3_KEY, request)).signature).toBe(signature);
    },
  );

  it('SEC-15 builds the published canonical request, string to sign and header for S3 PUT Object', async () => {
    const signed = await sign(S3_KEY, PUT_OBJECT);
    expect(await sha256Hex(WELCOME)).toBe(WELCOME_HASH);
    expect(signed.canonicalRequest).toBe(
      [
        'PUT',
        '/test%24file.text',
        '',
        'date:Fri, 24 May 2013 00:00:00 GMT',
        `host:${BUCKET}`,
        `x-amz-content-sha256:${WELCOME_HASH}`,
        'x-amz-date:20130524T000000Z',
        'x-amz-storage-class:REDUCED_REDUNDANCY',
        '',
        'date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class',
        WELCOME_HASH,
      ].join('\n'),
    );
    expect(signed.stringToSign).toBe(
      'AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d',
    );
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('SEC-15 a request changed in any signed part, or signed with another secret, gets another signature', async () => {
    const base = (await sign(S3_KEY, PUT_OBJECT)).signature;
    const changed = [
      sign({ ...S3_KEY, secret: `${S3_KEY.secret}x` }, PUT_OBJECT),
      sign({ ...S3_KEY, region: 'auto' }, PUT_OBJECT),
      sign(S3_KEY, { ...PUT_OBJECT, method: 'POST' }),
      sign(S3_KEY, { ...PUT_OBJECT, url: `https://${BUCKET}/test$file.texu` }),
      sign(S3_KEY, { ...PUT_OBJECT, payloadHash: EMPTY }),
      sign(S3_KEY, { ...PUT_OBJECT, headers: { ...PUT_OBJECT.headers, Host: 'other.example' } }),
    ];
    for (const signed of await Promise.all(changed)) expect(signed.signature).not.toBe(base);
  });

  it('s3Headers signs host, the date and the body hash, and sends no host header of its own', async () => {
    const body = new TextEncoder().encode(WELCOME);
    const at = Date.UTC(2013, 4, 24);
    const sent = await s3Headers(S3_KEY, 'PUT', `https://${BUCKET}/test$file.text`, body, at);
    expect(Object.keys(sent).sort()).toEqual([
      'authorization',
      'x-amz-content-sha256',
      'x-amz-date',
    ]);
    expect(sent['x-amz-date']).toBe(amzDate(at));
    expect(amzDate(at)).toBe('20130524T000000Z');
    expect(sent['x-amz-content-sha256']).toBe(WELCOME_HASH);
    const expected = await sign(S3_KEY, {
      method: 'PUT',
      url: `https://${BUCKET}/test$file.text`,
      headers: { host: BUCKET, 'x-amz-date': amzDate(at), 'x-amz-content-sha256': WELCOME_HASH },
      payloadHash: WELCOME_HASH,
    });
    expect(sent.authorization).toBe(expected.authorization);
  });

  it('uriEncode keeps only the unreserved set and encodes UTF-8 bytes in upper-case hex', () => {
    expect(uriEncode(UNRESERVED)).toBe(UNRESERVED);
    expect(uriEncode('a b/$+=ሴ')).toBe('a%20b%2F%24%2B%3D%E1%88%B4');
  });
});
