import { describe, expect, it } from 'vitest';
import doc from '../../docs/ARCHITECTURE.md?raw';
import index from './index.ts?raw';

describe('the host gate is recorded where the chain is described', () => {
  it('ARCHITECTURE and the index header name host in the chain', () => {
    expect(doc).toMatch(/errors, host, session, CSRF, routes table/);
    expect(index.split('\n').slice(0, 3).join(' ')).toMatch(/then host, session, CSRF/);
    expect(index).toMatch(/sequence\(host, session, csrf, authz\)/);
  });

  it('the lab checklist tells the walker to edit ORIGIN as well as RP_ID', () => {
    expect(doc).toMatch(/edit `ORIGIN` \([^)]*\) and `RP_ID`/);
  });
});
