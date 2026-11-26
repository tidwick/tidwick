import type { APIRoute } from 'astro';
import { currentEnv } from '../../lib/env';
import { authorizationServer } from '../../oauth/metadata';

// Public, and a 404 with MCP off before this runs (csrf.ts).
export const GET: APIRoute = () => Response.json(authorizationServer(currentEnv().ORIGIN));
