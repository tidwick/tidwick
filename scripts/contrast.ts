// WCAG AA contrast over the colour tokens in src/styles/global.css, for the light theme and the dark one.
// Text pairs need 4.5:1 (1.4.3); a control's border and the focus ring need 3:1 against what they sit on
// (1.4.11). Tokens are oklch values; a translucent one is blended over the theme's background the way a browser
// blends it, in encoded sRGB. Takes the stylesheet as an optional argument so contrast.test.sh can check a mutant.
// Run with Node's type stripping: `node scripts/contrast.ts [path/to/global.css]`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rgb = [number, number, number];

const TEXT = 4.5;
const CONTROL = 3;

/** [foreground token, background token, minimum ratio]. A pair names tokens only, so a restyle changes the CSS. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['foreground', 'background', TEXT],
  ['foreground', 'card', TEXT],
  ['foreground', 'danger-surface', TEXT],
  ['card-foreground', 'card', TEXT],
  ['popover-foreground', 'popover', TEXT],
  ['muted-foreground', 'background', TEXT],
  ['muted-foreground', 'muted', TEXT],
  ['muted-foreground', 'danger-surface', TEXT],
  ['primary-foreground', 'primary', TEXT],
  ['secondary-foreground', 'secondary', TEXT],
  ['accent-foreground', 'accent', TEXT],
  ['foreground', 'notice-surface', TEXT],
  ['notice', 'notice-surface', TEXT],
  ['notice', 'background', TEXT],
  ['danger', 'background', TEXT],
  ['danger', 'danger-surface', TEXT],
  ['control', 'background', CONTROL],
  ['input', 'background', CONTROL],
  ['input', 'card', CONTROL],
  ['control', 'card', CONTROL],
  ['control', 'popover', CONTROL],
  ['control', 'danger-surface', CONTROL],
  ['ring', 'background', CONTROL],
  ['ring', 'card', CONTROL],
  ['ring', 'popover', CONTROL],
  ['ring', 'danger-surface', CONTROL],
  ['ring', 'notice-surface', CONTROL],
  ['ring', 'muted', CONTROL],
  ['ring', 'secondary', CONTROL],
  ['ring', 'accent', CONTROL],
  ['primary', 'background', CONTROL],
  ['destructive', 'background', CONTROL],
  ['destructive', 'danger-surface', CONTROL],
];

const encode = (linear: number): number =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
const decode = (encoded: number): number =>
  encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
const clip = (value: number): number => Math.min(1, Math.max(0, value));

/** An `oklch(L C h / alpha)` value as encoded sRGB (each channel 0 to 1) and its alpha. */
export function parseOklch(value: string): { rgb: Rgb; alpha: number } | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [lightness, chroma, hue] = [match[1], match[2], match[3]].map(Number) as Rgb;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1);
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return { rgb: linear.map((channel) => encode(clip(channel))) as Rgb, alpha };
}

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

export function ratio(one: Rgb, other: Rgb): number {
  const [high, low] = [luminance(one), luminance(other)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** The `--name: value;` lines of the first block that opens with `selector {`. */
export function tokens(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const found = new Map<string, string>();
  if (start === -1) return found;
  const body = css.slice(start, css.indexOf('}', start));
  for (const [, name = '', value = ''] of body.matchAll(/^\s*--([\w-]+):\s*(.+?);\s*$/gm)) {
    found.set(name, value);
  }
  return found;
}

/** A token as opaque encoded sRGB, blended over `under` when it is translucent. */
function solid(value: string | undefined, under: Rgb | null): Rgb | null {
  const parsed = value === undefined ? null : parseOklch(value);
  if (!parsed) return null;
  if (parsed.alpha === 1 || under === null) return parsed.rgb;
  return parsed.rgb.map(
    (channel, i) => channel * parsed.alpha + (under[i] ?? 0) * (1 - parsed.alpha),
  ) as Rgb;
}

/** One line per pair and theme: PASS or FAIL, the ratio, and what to change. */
export function check(css: string): { lines: string[]; failed: boolean } {
  const lines: string[] = [];
  let failed = false;
  for (const [theme, selector] of [
    ['light', ':root'],
    ['dark', '.dark'],
  ] as const) {
    const defined = tokens(css, selector);
    const base = solid(defined.get('background'), null);
    for (const [foreground, background, minimum] of PAIRS) {
      const label = `${theme} ${foreground} on ${background}`;
      const under = solid(defined.get(background), base);
      const over = solid(defined.get(foreground), under);
      if (under === null || over === null) {
        const missing = under === null ? background : foreground;
        lines.push(
          `FAIL ${label}: --${missing} is missing or not an oklch value in ${selector} of src/styles/global.css; define it`,
        );
        failed = true;
        continue;
      }
      const got = ratio(over, under);
      const verdict = got >= minimum ? 'PASS' : 'FAIL';
      failed ||= verdict === 'FAIL';
      const fix =
        verdict === 'PASS'
          ? ''
          : `; change --${foreground} or --${background} in ${selector} of src/styles/global.css`;
      lines.push(`${verdict} ${label} ${got.toFixed(2)}:1 (needs ${String(minimum)}:1)${fix}`);
    }
  }
  return { lines, failed };
}

if (import.meta.main) {
  const path = process.argv[2] ?? join(import.meta.dirname, '..', 'src', 'styles', 'global.css');
  const { lines, failed } = check(readFileSync(path, 'utf8'));
  console.log(lines.join('\n'));
  console.log(
    failed ? 'FAIL contrast: fix the pairs above' : `PASS contrast: ${String(lines.length)} pairs`,
  );
  process.exit(failed ? 1 : 0);
}
