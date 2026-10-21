/**
 * SMS provider adapter. Two implementations:
 *
 *  - SimulatedSmsProvider (default, and ALWAYS in tests): records messages in
 *    memory and logs a masked line. Nothing leaves the machine.
 *  - TwilioSmsProvider: plain fetch to Twilio's REST API. Selected only when
 *    SMS_MODE=live AND TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM AND
 *    SMS_LIVE_ACK=1 are all set, and never under NODE_ENV=test. This code has
 *    never executed against Twilio — there is no account.
 *
 * Mirrors backend/stripe/client.ts: the mode is resolved once, the reason is
 * reported, and a half-configured environment degrades to simulated rather
 * than failing open.
 */
import { env } from '../env';
import { maskPhone } from './phone';

export type SmsMode = 'simulated' | 'live';

export interface SmsSendResult {
  providerMessageId: string;
}

export interface SmsProvider {
  readonly mode: SmsMode;
  send(to: string, body: string, opts?: { sensitive?: boolean }): Promise<SmsSendResult>;
}

export class SmsSendError extends Error {
  constructor(
    message: string,
    /** false = don't retry (bad number, opted out at carrier). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function resolveSmsMode(): { mode: SmsMode; reason: string } {
  if (env.smsModeRaw !== 'live') return { mode: 'simulated', reason: 'SMS_MODE is not "live".' };
  if (env.nodeEnv === 'test') return { mode: 'simulated', reason: 'Tests never send real SMS.' };
  const missing = [
    !env.twilioAccountSid && 'TWILIO_ACCOUNT_SID',
    !env.twilioAuthToken && 'TWILIO_AUTH_TOKEN',
    !env.twilioFrom && 'TWILIO_FROM',
    !env.smsLiveAck && 'SMS_LIVE_ACK=1',
  ].filter(Boolean);
  if (missing.length > 0) {
    return { mode: 'simulated', reason: `Live SMS needs ${missing.join(', ')}.` };
  }
  return { mode: 'live', reason: 'Live SMS via Twilio.' };
}

export type SimulatedSms = { to: string; body: string; at: Date; id: string; sensitive: boolean };

export class SimulatedSmsProvider implements SmsProvider {
  readonly mode = 'simulated' as const;
  readonly sent: SimulatedSms[] = [];
  /** Test hook: make the next N sends fail (retryable). */
  failNext = 0;
  private seq = 0;

  async send(to: string, body: string, opts?: { sensitive?: boolean }): Promise<SmsSendResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new SmsSendError('Simulated delivery failure.', true);
    }
    const id = `sim_${Date.now()}_${++this.seq}`;
    this.sent.push({ to, body, at: new Date(), id, sensitive: !!opts?.sensitive });
    if (this.sent.length > 500) this.sent.shift();
    // Verification codes are printed in full only outside production, the
    // same rule the simulated email code follows. Everything else is fine to
    // print: it carries no secret.
    const shown = opts?.sensitive && env.isProduction ? body.replace(/\d{4,}/g, '••••••') : body;
    console.log(`[SIMULATED SMS] to ${maskPhone(to)}: ${shown}`);
    return { providerMessageId: id };
  }
}

export class TwilioSmsProvider implements SmsProvider {
  readonly mode = 'live' as const;

  async send(to: string, body: string): Promise<SmsSendResult> {
    const sid = env.twilioAccountSid!;
    const from = env.twilioFrom!;
    const form = new URLSearchParams({ To: to, Body: body });
    if (from.startsWith('MG')) form.set('MessagingServiceSid', from);
    else form.set('From', from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${env.twilioAuthToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!res.ok || !json.sid) {
      // 4xx other than 429 are permanent (invalid number, unsubscribed 21610).
      const retryable = res.status >= 500 || res.status === 429;
      throw new SmsSendError(`Twilio ${res.status} ${json.code ?? ''}: ${json.message ?? 'send failed'}`, retryable);
    }
    return { providerMessageId: json.sid };
  }
}

let provider: SmsProvider | null = null;

export function smsProvider(): SmsProvider {
  if (!provider) {
    provider = resolveSmsMode().mode === 'live' ? new TwilioSmsProvider() : new SimulatedSmsProvider();
  }
  return provider;
}

/** Test hook: swap in a provider (usually a fresh SimulatedSmsProvider). */
export function setSmsProviderForTests(p: SmsProvider): void {
  provider = p;
}
