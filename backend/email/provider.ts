/**
 * Email provider adapter for sign-in / campus-verification codes.
 *
 *  - SimulatedEmailProvider (default, and ALWAYS in tests): nothing is sent.
 *    The message is printed to the server log so a developer — or, as a
 *    stopgap, the operator reading the logs — can see the code.
 *  - ResendEmailProvider: plain fetch to Resend's REST API. Selected only when
 *    EMAIL_MODE=live AND RESEND_API_KEY AND EMAIL_FROM are set, and never
 *    under NODE_ENV=test. In live mode codes are never written to the log.
 *
 * Same shape as backend/sms/provider.ts: mode resolved from env with a
 * reason, half-configured environments degrade to simulated.
 */
import { env } from '../env';

export type EmailMode = 'simulated' | 'live';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly mode: EmailMode;
  send(msg: EmailMessage): Promise<{ providerMessageId: string }>;
}

export class EmailSendError extends Error {}

export function resolveEmailMode(): { mode: EmailMode; reason: string } {
  if (env.emailModeRaw !== 'live') return { mode: 'simulated', reason: 'EMAIL_MODE is not "live".' };
  if (env.nodeEnv === 'test') return { mode: 'simulated', reason: 'Tests never send real email.' };
  const missing = [!env.resendApiKey && 'RESEND_API_KEY', !env.emailFrom && 'EMAIL_FROM'].filter(Boolean);
  if (missing.length > 0) return { mode: 'simulated', reason: `Live email needs ${missing.join(', ')}.` };
  return { mode: 'live', reason: 'Live email via Resend.' };
}

export type SimulatedEmail = EmailMessage & { at: Date; id: string };

export class SimulatedEmailProvider implements EmailProvider {
  readonly mode = 'simulated' as const;
  readonly sent: SimulatedEmail[] = [];
  /** Test hook: make the next N sends fail. */
  failNext = 0;
  private seq = 0;

  async send(msg: EmailMessage) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new EmailSendError('Simulated delivery failure.');
    }
    const id = `sim_email_${Date.now()}_${++this.seq}`;
    this.sent.push({ ...msg, at: new Date(), id });
    if (this.sent.length > 500) this.sent.shift();
    console.log(`[SIMULATED EMAIL] to ${msg.to} — ${msg.subject}: ${msg.text}`);
    return { providerMessageId: id };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly mode = 'live' as const;

  async send(msg: EmailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.emailFrom, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !json.id) {
      // Never include the message body (it contains the code) in the error.
      throw new EmailSendError(`Resend ${res.status}: ${json.name ?? ''} ${json.message ?? 'send failed'}`.trim());
    }
    return { providerMessageId: json.id };
  }
}

let provider: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (!provider) {
    provider = resolveEmailMode().mode === 'live' ? new ResendEmailProvider() : new SimulatedEmailProvider();
  }
  return provider;
}

/** Test hook. */
export function setEmailProviderForTests(p: EmailProvider): void {
  provider = p;
}

/** The sign-in / verification code email. Plain and short so it isn't flagged as marketing. */
export function codeEmail(to: string, code: string, purpose: 'sign_in' | 'verify_campus'): EmailMessage {
  const what = purpose === 'sign_in' ? 'sign in to Dibbs' : 'verify your campus email on Dibbs';
  const text =
    `Your code to ${what} is ${code}. It expires in 10 minutes.\n\n` +
    `If you didn't ask for this, you can ignore this email — nobody can sign in without the code.`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#161513">` +
    `<p>Your code to ${what} is:</p>` +
    `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>` +
    `<p style="color:#6F6A62">It expires in 10 minutes. If you didn't ask for this, you can ignore this email — nobody can sign in without the code.</p>` +
    `</div>`;
  return { to, subject: `${code} is your Dibbs code`, text, html };
}
