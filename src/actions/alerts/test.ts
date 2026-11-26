import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { sendTestAlert } from '../../backup/test-alert';
import { currentEnv } from '../../lib/env';
import { bindingMailer } from '../../lib/mail';
import { act, scopeOf } from '../context';
import { csrfField } from '../inputs';

export default defineAction({
  accept: 'form',
  input: z.object({ ...csrfField }),
  handler: (_input, context) =>
    act(() => {
      const { DB, EMAIL, MAIL_FROM } = currentEnv();
      const mailer = EMAIL === null || MAIL_FROM === null ? null : bindingMailer(EMAIL, MAIL_FROM);
      return sendTestAlert(scopeOf(context), DB, mailer, Date.now());
    }),
});
