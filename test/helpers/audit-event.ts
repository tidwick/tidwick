import type { AuditEvent } from '../../src/db/audit-actions';

/** A synthetic event name for a test that exercises the chain, not the vocabulary. */
export const synthetic = (name: string): AuditEvent => name as AuditEvent;
