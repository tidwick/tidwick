// The operator-policy numbers, parsed once with the rest of the env (`env.ts`): a list, a cap, a lifetime a firm
// may reasonably set differently. Unset or empty is the default; anything else outside its bounds fails
// `missing_binding` naming the variable, so a typo stops the deploy's first request rather than loosening a rule.
import { fail } from './errors';
import { KNOBS, TOKEN_DAYS } from './policy-table';

type Source = Record<string, unknown>;

export type Policy = { readonly [K in (typeof KNOBS)[number]['key']]: number } & {
  /** The lives, in days, a person may give an agent token; ascending. */
  readonly agentTokenDays: readonly number[];
};

/** A whole number, written as a number or as digits; null when the variable is unset or empty. */
function whole(value: unknown): number | null | undefined {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  return typeof value === 'string' && /^\s*\d{1,9}\s*$/.test(value) ? Number(value) : undefined;
}

/** `AGENT_TOKEN_DAYS`: distinct whole days, comma separated or an array, shortest first. */
function lives(source: Source): readonly number[] {
  const raw = source[TOKEN_DAYS.name];
  if (raw === undefined || raw === '') return TOKEN_DAYS.def;
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const days = parts.map((part) => whole(typeof part === 'string' ? part.trim() : part));
  const ok =
    days.length >= 1 &&
    days.length <= TOKEN_DAYS.count &&
    days.every((d) => typeof d === 'number' && d >= TOKEN_DAYS.min && d <= TOKEN_DAYS.max);
  const sorted = days.filter((d) => typeof d === 'number').sort((a, b) => a - b);
  if (!ok || new Set(sorted).size !== sorted.length) fail('missing_binding', TOKEN_DAYS.name);
  return sorted;
}

/** Reads every knob from `source`. With `gaps`, a refused one is recorded by name and left at its default. */
export function readPolicy(source: Source, gaps?: string[]): Policy {
  const out: Record<string, number | readonly number[]> = {};
  const read = (
    name: string,
    once: () => number | readonly number[],
    fallback: number | readonly number[] = 0,
  ): number | readonly number[] => {
    try {
      return once();
    } catch (error) {
      if (gaps === undefined) throw error;
      gaps.push(name);
      return fallback;
    }
  };
  for (const knob of KNOBS) {
    out[knob.key] = read(knob.name, () => {
      const value = whole(source[knob.name]);
      if (value === undefined || (value !== null && (value < knob.min || value > knob.max)))
        fail('missing_binding', knob.name);
      return (value ?? knob.def) * knob.scale;
    });
  }
  out['agentTokenDays'] = read(TOKEN_DAYS.name, () => lives(source), TOKEN_DAYS.def);
  const days = out['agentTokenDays'] as readonly number[];
  const given = source['AGENT_TOKEN_DEFAULT_DAYS'];
  if (given === undefined || given === '')
    out['agentTokenDefaultDays'] = days.includes(30) ? 30 : (days[days.length - 1] ?? 30);
  else if (!days.includes(out['agentTokenDefaultDays'] as number)) {
    if (gaps === undefined) fail('missing_binding', 'AGENT_TOKEN_DEFAULT_DAYS');
    else gaps.push('AGENT_TOKEN_DEFAULT_DAYS');
  }
  if ((out['sessionIdleMs'] as number) > (out['sessionMaxMs'] as number)) {
    if (gaps === undefined) fail('missing_binding', 'SESSION_IDLE_HOURS');
    else gaps.push('SESSION_IDLE_HOURS');
  }
  return out as Policy;
}

/** What an unconfigured deploy runs; tests and the demo build use it. */
export const DEFAULT_POLICY: Policy = readPolicy({});
