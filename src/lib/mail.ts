// The email interface: alerts go through a `Mailer`. The Worker's is the send-email
// binding; tests pass the double in test/helpers/mail.ts (`recordingMailer()`). All mail goes through a `Mailer`.
import { EmailMessage } from 'cloudflare:email';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** A header value on one line: a CR or LF in a subject or address could otherwise add headers. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** A plain-text RFC 5322 message with CRLF line ends. */
export function mimeText(from: string, mail: Mail, now: number, id: string): string {
  const domain = from.split('@')[1] ?? 'localhost';
  const body = mail.text.replace(/\r?\n/g, '\r\n');
  return [
    `From: ${oneLine(from)}`,
    `To: ${oneLine(mail.to)}`,
    `Subject: ${oneLine(mail.subject)}`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');
}

/** Sends through the Worker's send-email binding from `from`. */
export function bindingMailer(binding: SendEmail, from: string): Mailer {
  return {
    async send(mail) {
      const raw = mimeText(from, mail, Date.now(), crypto.randomUUID());
      await binding.send(new EmailMessage(oneLine(from), oneLine(mail.to), raw));
    },
  };
}
