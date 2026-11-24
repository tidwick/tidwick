// Astro's middleware entry: the error boundary, then session, CSRF and the route table.
import { sequence } from 'astro:middleware';
import { authz } from './authz';
import { csrf } from './csrf';
import { errors } from './errors';
import { session } from './session';

export const onRequest = sequence(errors, session, csrf, authz);
