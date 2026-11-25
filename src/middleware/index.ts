// Astro's middleware entry: the error boundary, then session, CSRF and the route table. `/setup` alone takes
// its own gate instead of those three, since it has no session to read and no form to protect.
import { sequence } from 'astro:middleware';
import { authz } from './authz';
import { csrf } from './csrf';
import { errors } from './errors';
import { session } from './session';
import { setup } from './setup';

const app = sequence(session, csrf, authz);
const gate = setup();

export const onRequest = sequence(errors, (context, next) =>
  context.routePattern === '/setup' ? gate(context, next) : app(context, next),
);
