import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ENROLMENT_MS } from '../auth/enrol';
import { keyedHash } from '../auth/tokens';
import { currentEnv } from '../lib/env';
import { unwrapClientKey } from '../lib/note-crypto';
import { checkChain } from './audit';
import { BOOTSTRAP_ENROLMENT_MS, bootstrapRefusal, bootstrapSql } from './bootstrap';
import { openEnrolment } from './enrolments';
import {
  adminGrants,
  BOOTSTRAP_NOW,
  bootstrapFile,
  rowCounts,
  seizeAttempt,
} from './test-support-bootstrap';

// The tests in this file share one database, in order: empty, then bootstrapped by `firstFile`.
let firstFile = '';

describe('first admin bootstrap', () => {
  it('SEC-29 bootstrap on an empty database creates one admin and a working enrolment link', async () => {
    expect((await rowCounts(env.DB)).audit_event).toBe(0);
    const { sql, token } = await bootstrapFile('ada@example.test');
    firstFile = sql;
    await env.DB.exec(sql);

    expect(await adminGrants(env.DB)).toBe(1);
    const hash = await keyedHash(currentEnv().SESSION_SECRET, 'enrol', token);
    const person = await env.DB.prepare(
      "SELECT id FROM person WHERE email = 'ada@example.test'",
    ).first<{ id: string }>();
    const enrolment = await openEnrolment(env.DB, hash, BOOTSTRAP_NOW + 1);
    expect(enrolment?.person_id).toBe(person?.id);
    expect(enrolment?.expires_at).toBe(BOOTSTRAP_NOW + ENROLMENT_MS);
    expect(await openEnrolment(env.DB, hash, BOOTSTRAP_NOW + ENROLMENT_MS)).toBeNull();

    const chain = await checkChain(env.DB);
    expect(chain.ok && chain.head.seq).toBe(1);
    const key = await env.DB.prepare(
      'SELECT k.client_id, k.wrapped, k.iv FROM client_key k JOIN firm f ON f.client_id = k.client_id',
    ).first<{ client_id: string; wrapped: ArrayBuffer; iv: ArrayBuffer }>();
    const plain = await unwrapClientKey(currentEnv().NOTE_KEK, key?.client_id ?? '', 1, {
      wrapped: new Uint8Array(key?.wrapped ?? new ArrayBuffer(0)),
      iv: new Uint8Array(key?.iv ?? new ArrayBuffer(0)),
    });
    expect(plain).toHaveLength(32);
  });

  it('SEC-29 a second bootstrap, or the same file run again, writes nothing once an admin exists', async () => {
    expect(firstFile).not.toBe('');
    const counts = await rowCounts(env.DB);
    await env.DB.exec(firstFile);
    expect(await rowCounts(env.DB)).toEqual(counts);

    const { before, after } = await seizeAttempt(env.DB);
    expect(after).toEqual(before);
    expect(await adminGrants(env.DB)).toBe(1);
  });

  it('the bootstrap link lasts as long as every other enrolment link', () => {
    expect(BOOTSTRAP_ENROLMENT_MS).toBe(ENROLMENT_MS);
  });

  it('a name holding a quote or ?1 renders once and stays one value', async () => {
    const statements = await bootstrapSql({
      email: 'a@example.test',
      name: "O'Hara ?1 ?2",
      firm: 'F',
      personId: 'p',
      firmId: 'f',
      clientId: 'c',
      key: { wrapped: new Uint8Array(1), iv: new Uint8Array(1), kekId: 'k' },
      enrolmentHash: 'h',
      now: 1,
    });
    const person = statements.find((s) => s.startsWith('INSERT INTO person (')) ?? '';
    expect(person).toContain(
      "SELECT 'p', 'f', 'a@example.test', 'O''Hara ?1 ?2', 1 WHERE (SELECT count(*)",
    );
  });

  it('bootstrapRefusal refuses a bad email and a control character', () => {
    expect(bootstrapRefusal('ada@example.test', 'Ada', 'Firm')).toBeNull();
    expect(bootstrapRefusal('not-an-email', 'Ada', 'Firm')).toContain('not an email');
    expect(bootstrapRefusal('ada@example.test', 'Ad\na', 'Firm')).toContain('name');
    expect(bootstrapRefusal('ada@example.test', 'Ada', ' ')).toContain('firm');
  });
});
