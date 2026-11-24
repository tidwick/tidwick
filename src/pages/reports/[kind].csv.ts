import type { APIRoute } from 'astro';
import { runReport } from '../../db/exports';
import { fail } from '../../lib/errors';
import { isReportKind } from '../../lib/report';
import { csvEndpoint, csvEnv } from '../_csv';

export const POST: APIRoute = (context) =>
  csvEndpoint(context, { href: '/reports', label: 'Back to reports' }, (scope, range) => {
    const kind = context.params.kind ?? '';
    if (!isReportKind(kind)) fail('not_found');
    return runReport(scope, csvEnv().db, kind, range, Date.now());
  });
