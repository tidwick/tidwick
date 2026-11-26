// The operator-policy knobs: each variable's default, a valid value, a value past either bound, and garbage, then the
// places that document the table (ARCHITECTURE, .dev.vars.example, wrangler.jsonc) held to the code.
import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { DEFAULT_POLICY, readPolicy } from './policy';
import { KNOBS, POLICY_NAMES, TOKEN_DAYS } from './policy-table';

const docs = import.meta.glob<string>(
  ['../../docs/ARCHITECTURE.md', '../../.dev.vars.example', '../../wrangler.jsonc'],
  { query: '?raw', import: 'default', eager: true },
);
const text = (name: string): string => docs[`../../${name}`] ?? '';

function refused(source: Record<string, unknown>): string {
  try {
    readPolicy(source);
  } catch (error) {
    if (error instanceof AppError && error.code === 'missing_binding') return error.detail ?? '';
    throw error;
  }
  return expect.unreachable('readPolicy accepted the value');
}

describe('policy knobs', () => {
  it('an unconfigured deploy keeps every number it had before the knobs existed', () => {
    expect(DEFAULT_POLICY).toEqual({
      agentTokenMax: 5,
      agentTokenDays: [7, 30, 90],
      agentTokenDefaultDays: 30,
      mcpAccessMs: 3_600_000,
      mcpRefreshIdleMs: 30 * 86_400_000,
      mcpGrantMs: 90 * 86_400_000,
      sessionIdleMs: 8 * 3_600_000,
      sessionMaxMs: 14 * 86_400_000,
      stepUpMs: 15 * 60_000,
      enrolmentMs: 86_400_000,
      pendingCodesMs: 600_000,
      auditPage: 50,
      approvalsPage: 500,
      notSubmittedWeeks: 4,
      reportMaxDays: 366,
      reportMaxBars: 40,
      importMaxRows: 5000,
      importMaxNew: 50,
      backupTries: 3,
      backupRetryPauseMs: 2000,
      backupKeepMs: 40 * 86_400_000,
    });
  });

  describe.each(KNOBS)('$name', (knob) => {
    const stored = (value: number): number => value * knob.scale;

    // A default life must be one of the lives offered, so its bounds are tried against a list that holds both.
    const around: Record<string, unknown> =
      knob.name === 'AGENT_TOKEN_DEFAULT_DAYS'
        ? { AGENT_TOKEN_DAYS: `${String(knob.min)},${String(knob.max)}` }
        : {};
    const read = (value: unknown) => readPolicy({ ...around, [knob.name]: value })[knob.key];

    it('is its default when unset or empty', () => {
      expect(readPolicy({})[knob.key]).toBe(stored(knob.def));
      expect(readPolicy({ [knob.name]: '' })[knob.key]).toBe(stored(knob.def));
    });

    it('takes a number or digits inside its bounds, the bounds included', () => {
      expect(read(knob.min)).toBe(stored(knob.min));
      expect(read(String(knob.max))).toBe(stored(knob.max));
    });

    it('is refused by name one past either bound', () => {
      expect(refused({ ...around, [knob.name]: knob.max + 1 })).toBe(knob.name);
      expect(refused({ ...around, [knob.name]: knob.min > 0 ? knob.min - 1 : -1 })).toBe(knob.name);
    });

    it('is refused by name when it is not a whole number', () => {
      for (const garbage of ['abc', '1.5', '-1', '1e3', '0x10', ' ', 'five', true, null, {}, 2.5]) {
        expect(refused({ [knob.name]: garbage }), JSON.stringify(garbage)).toBe(knob.name);
      }
    });
  });

  describe('AGENT_TOKEN_DAYS', () => {
    it('is 7, 30, 90 unset, and a list sorted shortest first from a string or an array', () => {
      expect(readPolicy({}).agentTokenDays).toEqual([7, 30, 90]);
      expect(readPolicy({ AGENT_TOKEN_DAYS: '' }).agentTokenDays).toEqual([7, 30, 90]);
      expect(readPolicy({ AGENT_TOKEN_DAYS: '90, 14,1' }).agentTokenDays).toEqual([1, 14, 90]);
      expect(readPolicy({ AGENT_TOKEN_DAYS: [60, 7] }).agentTokenDays).toEqual([7, 60]);
      expect(readPolicy({ AGENT_TOKEN_DAYS: '365' }).agentTokenDays).toEqual([365]);
    });

    it('is refused by name when empty entries, repeats, too many, out of bounds or garbage', () => {
      const bad = [
        '7,,30',
        '7,7',
        '1,2,3,4,5,6,7',
        '0',
        '366',
        '7,x',
        '7;30',
        '1.5',
        [7, 'x'],
        7.5,
      ];
      for (const value of bad)
        expect(refused({ AGENT_TOKEN_DAYS: value }), String(value)).toBe(TOKEN_DAYS.name);
    });

    it('has a default life that is 30 when listed, else the longest, and that must be listed when set', () => {
      expect(readPolicy({ AGENT_TOKEN_DAYS: '7,30' }).agentTokenDefaultDays).toBe(30);
      expect(readPolicy({ AGENT_TOKEN_DAYS: '7,14' }).agentTokenDefaultDays).toBe(14);
      expect(readPolicy({ AGENT_TOKEN_DEFAULT_DAYS: '7' }).agentTokenDefaultDays).toBe(7);
      expect(refused({ AGENT_TOKEN_DEFAULT_DAYS: '45' })).toBe('AGENT_TOKEN_DEFAULT_DAYS');
      expect(refused({ AGENT_TOKEN_DAYS: '7,14', AGENT_TOKEN_DEFAULT_DAYS: '30' })).toBe(
        'AGENT_TOKEN_DEFAULT_DAYS',
      );
    });
  });

  it('refuses an idle limit longer than the absolute one, naming the idle variable', () => {
    expect(refused({ SESSION_IDLE_HOURS: '72', SESSION_MAX_DAYS: '2' })).toBe('SESSION_IDLE_HOURS');
    expect(readPolicy({ SESSION_IDLE_HOURS: '48', SESSION_MAX_DAYS: '2' }).sessionIdleMs).toBe(
      48 * 3_600_000,
    );
  });

  it('never lets step-up outlast 15 minutes, the age the security model allows', () => {
    expect(readPolicy({ STEP_UP_MINUTES: 15 }).stepUpMs).toBe(15 * 60_000);
    expect(refused({ STEP_UP_MINUTES: 16 })).toBe('STEP_UP_MINUTES');
  });
});

describe('the knob table is documented where an operator looks', () => {
  const architecture = text('docs/ARCHITECTURE.md');
  const rowOf = (name: string): string[] => {
    const line = architecture.split('\n').find((l) => l.startsWith(`| \`${name}\``)) ?? '';
    return line
      .split('|')
      .slice(2, 5)
      .map((cell) => cell.trim());
  };

  it.each(KNOBS)('ARCHITECTURE lists $name with its default and bounds', (knob) => {
    expect(rowOf(knob.name)).toEqual([String(knob.def), String(knob.min), String(knob.max)]);
  });

  it('ARCHITECTURE lists AGENT_TOKEN_DAYS with its default list and bounds', () => {
    expect(rowOf(TOKEN_DAYS.name)).toEqual([
      TOKEN_DAYS.def.join(','),
      String(TOKEN_DAYS.min),
      String(TOKEN_DAYS.max),
    ]);
  });

  it.each(POLICY_NAMES)('.dev.vars.example and wrangler.jsonc both name %s', (name) => {
    expect(text('.dev.vars.example')).toMatch(new RegExp(`^${name}=$`, 'm'));
    expect(text('wrangler.jsonc')).toMatch(new RegExp(`^\\s*// ${name} `, 'm'));
  });
});
