import type { APIRoute } from 'astro';
import { healthResponse } from '../backup/health';
import { currentEnv } from '../lib/env';

export const GET: APIRoute = () => healthResponse(currentEnv().DB, Date.now());
