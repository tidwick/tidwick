// The signer against cases from AWS's Signature Version 4 test suite (kept in awslabs/aws-c-auth under
// tests/aws-signing-test-suite/v4): one key, one host, one instant, and a request line per case.
import { describe, expect, it } from 'vitest';
import { sha256Hex, sign } from './sigv4';

const KEY = {
  keyId: 'AKIDEXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
};
const HOST = 'example.amazonaws.com';
const AT = { Host: HOST, 'X-Amz-Date': '20150830T123600Z' };
const UNRESERVED = '-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

interface Case {
  line: string;
  headers?: Record<string, string>;
  body?: string;
  signature: string;
}

const CASES: Record<string, Case> = {
  'get-vanilla': {
    line: 'GET /',
    signature: '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  },
  'get-vanilla-query-order-key-case': {
    line: 'GET /?Param2=value2&Param1=value1',
    signature: 'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
  },
  'get-vanilla-query-unreserved': {
    line: `GET /?${UNRESERVED}=${UNRESERVED}`,
    signature: '9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197',
  },
  'get-vanilla-utf8-query': {
    line: 'GET /?ሴ=bar',
    signature: '2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04',
  },
  'get-unreserved': {
    line: `GET /${UNRESERVED}`,
    signature: '07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f',
  },
  'get-utf8': {
    line: 'GET /ሴ',
    signature: '8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85',
  },
  'get-header-value-trim': {
    line: 'GET /',
    headers: { 'My-Header1': ' value1', 'My-Header2': ' "a   b   c"' },
    signature: 'acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736',
  },
  'post-vanilla': {
    line: 'POST /',
    signature: '5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b',
  },
  'post-vanilla-query': {
    line: 'POST /?Param1=value1',
    signature: '28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11',
  },
  'post-header-key-sort': {
    line: 'POST /',
    headers: { 'My-Header1': 'value1' },
    signature: 'c5410059b04c1ee005303aed430f6e6645f61f4dc9e1461ec8f8916fdf18852c',
  },
  'post-header-value-case': {
    line: 'POST /',
    headers: { 'My-Header1': 'VALUE1' },
    signature: 'cdbc9802e29d2942e5e10b5bccfdd67c5f22c7c4e8ae67b53629efa58b974b7d',
  },
  'post-x-www-form-urlencoded': {
    line: 'POST /',
    headers: FORM,
    body: 'Param1=value1',
    signature: 'ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
  },
};

describe('SEC-15 the SigV4 signer on the AWS test suite', () => {
  it.each(Object.entries(CASES))(
    'SEC-15 reproduces the published signature for %s',
    async (_name, { line, headers = {}, body = '', signature }) => {
      const [method = '', path = ''] = line.split(' ');
      const signed = await sign(KEY, {
        method,
        url: `https://${HOST}${path}`,
        headers: { ...headers, ...AT },
        payloadHash: await sha256Hex(body),
      });
      expect(signed.signature).toBe(signature);
      expect(signed.authorization).toContain(`Credential=AKIDEXAMPLE/20150830/us-east-1/service/`);
    },
  );
});
