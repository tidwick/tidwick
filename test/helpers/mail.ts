// The email double: records every message a `Mailer` would send, so a test counts alerts without a binding.
import type { Mail, Mailer } from '../../src/lib/mail';

export interface RecordingMailer extends Mailer {
  readonly sent: Mail[];
}

export function recordingMailer(): RecordingMailer {
  const sent: Mail[] = [];
  return {
    sent,
    send(mail) {
      sent.push(mail);
      return Promise.resolve();
    },
  };
}
