import type { APIRoute } from 'astro';
import { exportClient } from '../../db/exports';
import { csvEndpoint, csvEnv } from '../_csv';

export const POST: APIRoute = (context) =>
  csvEndpoint(context, { href: '/export', label: 'Back to export' }, (scope, range) => {
    const { db, keks } = csvEnv();
    return exportClient(scope, db, keks, context.params.client ?? '', range, Date.now());
  });
