/**
 * The policy every response carries. Astro appends `script-src` and `style-src` with the hashes of
 * what it emits on each page; responses Astro does not render get these directives alone.
 */
export const CSP_DIRECTIVES = [
  "default-src 'none'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
] as const;

const HASHED_ASSET_PREFIX = '/_astro/';

const PERMISSIONS_OFF = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'browsing-topics',
  'camera',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

const PERMISSIONS_POLICY = [
  ...PERMISSIONS_OFF.map((feature) => `${feature}=()`),
  'publickey-credentials-create=(self)',
  'publickey-credentials-get=(self)',
].join(', ');

const EVERY_RESPONSE: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': PERMISSIONS_POLICY,
};

/** Sets every security and caching header; a policy Astro rendered with its hashes is kept. */
export function withHeaders(request: Request, response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(EVERY_RESPONSE)) out.headers.set(name, value);
  // `astro dev` hashes nothing and inlines Vite's styles and scripts, so there the policy is left off.
  if (!import.meta.env.DEV && !out.headers.has('content-security-policy')) {
    out.headers.set('content-security-policy', CSP_DIRECTIVES.join('; '));
  }
  const hashed = out.ok && new URL(request.url).pathname.startsWith(HASHED_ASSET_PREFIX);
  out.headers.set('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-store');
  return out;
}

/** A name safe in a `Content-Disposition` filename: ASCII letters, digits, dot, dash and underscore only. */
function asciiName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'export' : cleaned;
}

/** A CSV file as an attachment; `withHeaders` adds `no-store` and the rest on its way out (SEC-24). */
export function csvDownload(text: string, filename: string): Response {
  return new Response(text, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${asciiName(filename)}.csv"`,
    },
  });
}
