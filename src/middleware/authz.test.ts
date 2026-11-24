// Runs in the `app` project: every route Astro built and every Action file meets the route table at the real
// middleware, through both Action callers.
import { describe, expect, it } from 'vitest';
import { caller, formPost, getPage, rpc, type Caller } from '../../test/helpers/callers';
import { builtRoutes, samplePath, type BuiltRoute } from '../../test/helpers/route-manifest';
import { GRANTS, type Grant } from '../db/roles';
import { ACTIONS, actionRule, PAGES, type Rule } from '../routes';
import { RPC_PATTERN } from './authz';

const ACTION_FILES = Object.keys(
  import.meta.glob(['../actions/*/*.ts', '!../actions/*/*.test.ts']),
).map((file) => file.replace(/^\.\.\/actions\/([^/]+)\/([^/]+)\.ts$/, '$1.$2'));

const DENIALS = new Set(['unauthenticated', 'forbidden', 'step_up_required']);
const GRANT_SETS: readonly (readonly Grant[])[] = [[], ...GRANTS.map((grant) => [grant])];

/** Built project routes with no PAGES row and Action files with no ACTIONS row. */
function undeclared(routes: readonly BuiltRoute[], actions: readonly string[]): string[] {
  const pages = routes.filter((r) => r.origin === 'project' && !Object.hasOwn(PAGES, r.route));
  return [...pages.map((r) => r.route), ...actions.filter((name) => !actionRule(name))];
}

const isPublic = (rule: Rule): boolean => rule.roles.includes('public');
const holds = (rule: Rule, grants: readonly Grant[]): boolean =>
  isPublic(rule) ||
  rule.roles.some((role) => role === 'member' || grants.some((grant) => grant === role));
const gatedActions = Object.entries(ACTIONS).filter(([, rule]) => !isPublic(rule));

function builtPages(): [string, Rule][] {
  return builtRoutes()
    .filter((r) => r.origin === 'project')
    .flatMap((r) => {
      const rule = PAGES[r.route]?.GET;
      return rule ? [[r.route, rule] as [string, Rule]] : [];
    });
}

/** The denial a response carries, or null when the route table let it through. */
async function denial(response: Response): Promise<string | null> {
  if (response.status !== 401 && response.status !== 403) return null;
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('application/json')) return String(response.status);
  const body: unknown = await response.json();
  const code = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
  return typeof code === 'string' && DENIALS.has(code) ? code : null;
}

const callers = new Map<string, Caller>();
async function reused(grants: readonly Grant[], mustEnrol = false): Promise<Caller> {
  const key = `${grants.join(',')}|${String(mustEnrol)}`;
  const existing = callers.get(key);
  if (existing) return existing;
  const made = await caller(grants, { mustEnrol });
  callers.set(key, made);
  return made;
}

describe('SEC-09 the route table covers every route and denies by default', () => {
  it('SEC-09 every route in the build manifest and every Action file has a row', () => {
    const routes = builtRoutes();
    expect(routes.map((r) => r.route)).toContain('/login');
    expect(routes.map((r) => r.route)).toContain(RPC_PATTERN);
    expect(ACTION_FILES).toContain('auth.loginOptions');
    expect(undeclared(routes, ACTION_FILES)).toEqual([]);
  });

  it('SEC-09 every ACTIONS row names an Action file', () => {
    expect(Object.keys(ACTIONS).filter((name) => !ACTION_FILES.includes(name))).toEqual([]);
  });

  it('SEC-09 a fixture route and a fixture Action with no row fail the enumeration', () => {
    const fixture = {
      route: '/fixture-undeclared',
      type: 'page',
      component: '',
      origin: 'project',
    };
    const routes = [...builtRoutes(), fixture];
    expect(undeclared(routes, [...ACTION_FILES, 'fixture.undeclared'])).toEqual([
      '/fixture-undeclared',
      'fixture.undeclared',
    ]);
  });

  it('SEC-09 framework routes other than Actions have no row and are refused to everyone', async () => {
    const internal = builtRoutes().filter((r) => r.origin !== 'project' && r.route !== RPC_PATTERN);
    expect(internal.length).toBeGreaterThan(0);
    const admin = await reused(GRANTS);
    for (const route of internal) {
      expect(await denial(await getPage(samplePath(route.route), null)), route.route).toBe('403');
      expect(await denial(await getPage(samplePath(route.route), admin)), route.route).toBe('403');
    }
  });

  it('SEC-09 signed out, every gated page and Action answers 401 by both callers', async () => {
    for (const [route, rule] of builtPages()) {
      const expected = isPublic(rule) ? null : '401';
      expect(await denial(await getPage(samplePath(route), null)), route).toBe(expected);
    }
    for (const [name] of gatedActions) {
      expect(await denial(await rpc(name, null)), name).toBe('unauthenticated');
      expect(await denial(await formPost('/login', name, null)), name).toBe('401');
    }
  });

  it('SEC-09 the wrong role gets 403 on every page and Action, by both callers', async () => {
    for (const grants of GRANT_SETS) {
      const who = await reused(grants);
      for (const [route] of builtPages().filter(([, r]) => !holds(r, grants))) {
        expect(await denial(await getPage(samplePath(route), who)), route).toBe('403');
      }
      for (const [name, rule] of gatedActions.filter(([, r]) => !holds(r, grants))) {
        expect(rule.roles).not.toContain('member');
        expect(await denial(await rpc(name, who)), `${name} ${grants.join()}`).toBe('forbidden');
        expect(await denial(await formPost('/login', name, who)), name).toBe('403');
      }
    }
  });

  it('SEC-05 and SEC-09 a must_enrol session is refused on every row not marked for recovery', async () => {
    const who = await reused(GRANTS, true);
    for (const [route, rule] of builtPages().filter(([, r]) => !isPublic(r))) {
      expect(await denial(await getPage(samplePath(route), who)), route).toBe(
        rule.recovery ? null : '403',
      );
    }
    for (const [name, rule] of gatedActions.filter(([, r]) => !r.recovery)) {
      expect(rule.recovery).toBe(false);
      expect(await denial(await rpc(name, who)), name).toBe('forbidden');
      expect(await denial(await formPost('/login', name, who)), name).toBe('403');
    }
  });

  it('SEC-09 the right role passes the gate on every row, by both callers', async () => {
    for (const [name, rule] of gatedActions) {
      const grants = GRANT_SETS.find((set) => holds(rule, set)) ?? [];
      expect(await denial(await rpc(name, await caller(grants))), name).toBeNull();
      expect(await denial(await formPost('/login', name, await caller(grants))), name).toBeNull();
    }
    for (const [route, rule] of builtPages()) {
      const grants = GRANT_SETS.find((set) => holds(rule, set)) ?? [];
      expect(
        await denial(await getPage(samplePath(route), await reused(grants))),
        route,
      ).toBeNull();
    }
  });

  it("SEC-09 the Action client's trailing-slash path is judged by the same row", async () => {
    const member = await caller([]);
    for (const [name, rule] of gatedActions) {
      const expected = holds(rule, []) ? null : 'forbidden';
      expect(await denial(await rpc(`${name}/`, member)), name).toBe(expected);
    }
    expect(await denial(await rpc('entries.addRow/', null))).toBe('unauthenticated');
    expect(await denial(await rpc('fixture.undeclared/', await reused(GRANTS)))).toBe('forbidden');
  });

  it('SEC-09 an unlisted Action, a page POST with no Action, and a path and query naming two Actions are refused', async () => {
    const admin = await reused(GRANTS);
    expect(await denial(await rpc('fixture.undeclared', admin))).toBe('forbidden');
    expect(await denial(await formPost('/login', 'fixture.undeclared', admin))).toBe('403');
    expect(await denial(await formPost('/login', null, admin))).toBe('403');
    expect(await denial(await formPost('/account', null, null))).toBe('403');
    const twoNames = await rpc('auth.loginOptions?_action=people.setRoles', admin);
    expect(await denial(twoNames)).toBe('forbidden');
  });
});
