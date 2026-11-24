import { handle } from '@astrojs/cloudflare/handler';
import { scheduled } from './backup/scheduled';
import { withHeaders } from './headers';

export default {
  async fetch(request, env, ctx) {
    return withHeaders(request, await handle(request, env, ctx));
  },
  async scheduled(controller, env) {
    await scheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;
