import type { APIRoute } from 'astro';
import { handleMcp } from '../mcp/dispatch';

// The route table row is public: the gate is the bearer and, per tool, `authorize` (src/mcp/dispatch.ts).
export const GET: APIRoute = ({ request }) => handleMcp(request);
export const POST: APIRoute = ({ request }) => handleMcp(request);
