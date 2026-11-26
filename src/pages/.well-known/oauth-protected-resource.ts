import type { APIRoute } from 'astro';
import { currentEnv } from '../../lib/env';
import { protectedResource } from '../../oauth/metadata';

// Public, and a 404 with MCP off before this runs (csrf.ts). The same document answers the `/mcp` suffix form.
export const GET: APIRoute = () => Response.json(protectedResource(currentEnv().ORIGIN));
