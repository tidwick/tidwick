// Approving a request: one audited batch that replaces the person's earlier grant for the same client, makes the
// new grant and stores the one-use code. The grant stays "waiting" (it ends in 60 seconds) until the code is spent.
import { whileSignedIn } from '../auth/agent-personal';
import { keyedHash, randomToken } from '../auth/tokens';
import { insertGrant, insertToken, listedGrantsOf } from '../db/agent-grants';
import { revokeClientGrants } from '../db/agent-oauth';
import { auditedBatch, retryOnce } from '../db/audit';
import type { Scope } from '../db/scope';
import { fail } from '../lib/errors';
import { newId } from '../lib/ids';
import type { AuthRequest, ToolScope } from './authorize';

export const CODE_MS = 60 * 1000;

/** Stores a grant for `scopes` and returns its single-use code, which the caller hands to the client's redirect. */
/** `max` is `AGENT_TOKEN_MAX`: the live grants one person may hold, this client's replaced one not counted. */
export async function grantAccess(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  request: AuthRequest,
  scopes: readonly ToolScope[],
  max: number,
  now: number,
): Promise<string> {
  const code = randomToken();
  const hash = await keyedHash(secret, 'agent_code', code);
  const grantId = newId();
  const { client } = request;
  await whileSignedIn(db, personId, now, () =>
    retryOnce(async () => {
      const live = await listedGrantsOf(db, personId, now);
      const replaced = live.filter((g) => g.client_id === client.id).map((g) => g.id);
      if (live.length - replaced.length >= max) fail('agent_limit');
      const batch = await auditedBatch(scope, db);
      batch.also(revokeClientGrants(db, personId, client.id, now));
      await batch.record(
        insertGrant(
          db,
          {
            id: grantId,
            personId,
            clientId: client.id,
            clientName: client.name,
            redirectUri: request.redirectUri,
            scopes,
            expiresAt: now + CODE_MS,
            cap: max,
          },
          now,
        ),
        {
          at: now,
          action: 'agents.grant',
          clientId: null,
          target: `person:${personId}`,
          before: { replaced },
          after: { grant: grantId, client: client.id, name: client.name, scopes },
        },
        1,
      );
      batch.also(
        insertToken(db, {
          hash,
          grantId,
          kind: 'code',
          expiresAt: now + CODE_MS,
          challenge: request.challenge,
        }),
      );
      await batch.run();
    }),
  );
  return code;
}
