// Astro's middleware entry: the error boundary, then session, CSRF and the route table. `/setup` takes its own gate
// first: while the env does not parse it has no session to read and no form to protect, so it runs instead of those
// three; once the env parses it is a 404 unless the database is empty, and then it runs them like every other page.
import { sequence } from 'astro:middleware';
import { authz } from './authz';
import { csrf } from './csrf';
import { errors } from './errors';
import { host } from './host';
import { session } from './session';
import { setup } from './setup';

const app = sequence(host, session, csrf, authz);
const gate = setup(app);

export const onRequest = sequence(errors, (context, next) =>
  context.routePattern === '/setup' ? gate(context, next) : app(context, next),
);
