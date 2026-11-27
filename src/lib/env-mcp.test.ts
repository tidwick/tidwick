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

  it('SEC-71 LOCAL_DEV=on waives https for a loopback http ORIGIN only', () => {
    const local = { ...base, LOCAL_DEV: 'on' };
    for (const host of ['http://localhost:4321', 'http://127.0.0.1', 'http://[::1]:4321'])
      expect(detail({ ...local, ORIGIN: host }), host).toBeUndefined();
    for (const host of ['http://tidwick.test', 'http://localhost.example', 'http://10.0.0.5:4321'])
      expect(detail({ ...local, ORIGIN: host, RP_ID: 'tidwick.test' }), host).toBe('ORIGIN');
  });
});
