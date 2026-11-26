import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { readEnv } from './env';
import { AppError } from './errors';

const base = { ...env, ORIGIN: 'http://localhost:4321', RP_ID: 'localhost', MCP: 'on' };

function detail(source: object): string | undefined {
  try {
    readEnv(source);
  } catch (error) {
    if (error instanceof AppError) return error.detail;
    throw error;
  }
  return undefined;
}

describe('MCP and ORIGIN', () => {
  it('SEC-71 MCP=on needs an https ORIGIN unless LOCAL_DEV=on, so the shipped http default never opens the agent routes', () => {
    expect(detail(base)).toBe('ORIGIN');
    expect(readEnv({ ...base, LOCAL_DEV: 'on' }).MCP).toBe(true);
    const https = { ...base, ORIGIN: 'https://time.example', RP_ID: 'time.example' };
    expect(readEnv(https).MCP).toBe(true);
    expect(detail({ ...base, MCP: '' })).toBeUndefined();
    expect(detail({ ...base, LOCAL_DEV: 'yes' })).toBe('LOCAL_DEV');
  });
});
