// What the week Actions return: the canonical week, which replaces the island's state. `entries.*` and
// `submission.submit` return the caller's own; `entriesFor.*`, approve and return the week of the person named.
import type { ActionAPIContext } from 'astro:actions';
import { loadWeek } from '../db/week-view';
import { currentEnv, noteKeks } from '../lib/env';
import { fail } from '../lib/errors';
import type { WeekView } from '../lib/week';
import { scopeOf } from './context';

export async function personWeek(
  context: ActionAPIContext,
  personId: string,
  weekStart: string,
): Promise<WeekView> {
  return loadWeek(scopeOf(context), currentEnv().DB, noteKeks(), personId, weekStart);
}

export async function ownWeek(context: ActionAPIContext, weekStart: string): Promise<WeekView> {
  return personWeek(context, scopeOf(context).actorId ?? fail('forbidden'), weekStart);
}
