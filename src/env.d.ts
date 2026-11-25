declare namespace App {
  interface Locals {
    /** The live session, set by `src/middleware/session.ts` before any route runs; null when signed out. */
    session: import('./auth/session').Session | null;
    /** The session's synchronizer token for forms and script calls; empty when signed out. */
    csrf: string;
    /** `Set-Cookie` values Actions queue; the session middleware appends them to the response. */
    cookies: string[];
    /** The caller's scope for `src/db/`, set by `src/middleware/authz.ts` on every non-public row; null otherwise. */
    scope: import('./db/scope').Scope | null;
    /** The caller's grants, read once by `src/middleware/authz.ts` on every non-public row; empty otherwise. */
    grants: readonly import('./db/roles').Grant[];
    /** Set only by `src/middleware/setup.ts` on `/setup`, for an instance with an empty database: the missing names, or the claim. */
    setup?: import('./middleware/setup').SetupReport;
  }
}
