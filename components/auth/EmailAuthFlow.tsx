/**
 * Email-first sign-in: campus email -> 6-digit code (+ name and 18+/Terms for a
 * first sign-in) -> signed in. Reused by /auth/sign-in, /auth/email and the
 * sign-up card on /welcome. A campus email proves you are a student there; it
 * is not an identity check.
 *
 * Like the old verify screen, the server creates the account when the code is
 * confirmed, and the client cannot know beforehand whether the email is new.
 * Typing a display name means "I'm setting up my account", which reveals (and
 * requires) the age + Terms consent. Existing users leave it blank.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/auth/Field';
import { Notice } from '@/components/auth/Notice';
import { CheckboxRow } from '@/components/auth/CheckboxRow';
import { describeError, secondsFromMessage } from '@/components/auth/helpers';
import { useCooldown } from '@/components/auth/useCooldown';
import { useAuth } from '@/hooks/useAuth';
import { MINIMUM_AGE } from '@/constants/legal';
import { colors, radius, space } from '@/constants/theme';

export type AuthMode = 'signup' | 'login';

/** What the host needs to know once someone is signed in. */
export interface AuthFinish {
  /** True when this sign-in created the account — the host sends them to profile setup. */
  isNewAccount: boolean;
}

export interface EmailAuthFlowProps {
  onFinished: (result: AuthFinish) => void;
  /**
   * 'signup' asks for a name and the age/Terms consent up front; 'login' hides
   * them. Left unset, the combined "sign in or sign up" flow is used, where a
   * typed name means "I'm new".
   */
  mode?: AuthMode;
  /** Called for "Use your phone number instead". */
  onUsePhone?: () => void;
  /** Hide the first-step heading (the host card already has one). */
  hideFirstHeading?: boolean;
  submitLabel?: string;
}

export function EmailAuthFlow({
  onFinished,
  onUsePhone,
  hideFirstHeading,
  submitLabel = 'Email me a code',
  mode,
}: EmailAuthFlowProps) {
  const router = useRouter();
  const { requestCode, signInWithCode } = useAuth();
  const cooldown = useCooldown();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [network, setNetwork] = useState(false);

  const isSigningUp = mode === 'signup' || (mode !== 'login' && displayName.trim().length > 0);
  const nameOk = mode !== 'signup' || displayName.trim().length > 0;
  const gateOk = nameOk && (!isSigningUp || (ageOk && termsOk));

  async function sendCode(isResend: boolean) {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter your campus email address.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const res = await requestCode(trimmed);
      setNetwork(false);
      setSimulated(res.simulated);
      cooldown.start(res.resendAfterSeconds);
      setCode('');
      setStep('code');
      if (isResend) setInfo('New code sent.');
    } catch (e) {
      const d = describeError(e, 'Could not send a code. Try again.');
      setNetwork(d.network);
      setError(d.message);
      if (d.code === 'TOO_MANY_REQUESTS') {
        const secs = secondsFromMessage(d.message);
        if (secs && step === 'code') cooldown.start(Math.min(secs, 3600));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code.');
      return;
    }
    if (!nameOk) {
      setError('Enter your name to create your account.');
      return;
    }
    if (!gateOk) {
      setError('Confirm your age and agree to the Terms and Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const result = await signInWithCode(
        email.trim(),
        code.trim(),
        mode === 'login' ? undefined : displayName.trim() || undefined,
      );
      onFinished(result);
    } catch (e) {
      const d = describeError(e, 'That code didn’t work. Try again.');
      setNetwork(d.network);
      setError(d.message);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code') {
    const left = cooldown.secondsLeft;
    return (
      <View style={styles.wrap}>
        <Text variant="title">Enter your code</Text>
        <Text variant="body" color="inkMuted">
          We sent a 6-digit code to {email.trim()}.
        </Text>
        {simulated ? (
          <Notice tone="dev">Development mode: no email is sent — the code is printed in the server log.</Notice>
        ) : null}
        <Field
          label="6-digit code"
          placeholder="123456"
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/\D/g, '').slice(0, 6));
            setError(undefined);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          onSubmitEditing={submitCode}
          returnKeyType="done"
          editable={!busy}
          style={styles.codeInput}
        />
        {mode === 'login' ? null : (
        <Field
          label={mode === 'signup' ? 'Your name' : 'Your name (new accounts only)'}
          placeholder="e.g. Maya"
          value={displayName}
          onChangeText={(v) => {
            setDisplayName(v);
            setError(undefined);
          }}
          maxLength={60}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          editable={!busy}
        />
        )}
        {isSigningUp ? (
          <View style={styles.consent}>
            <CheckboxRow
              checked={ageOk}
              onToggle={() => setAgeOk((v) => !v)}
              accessibilityLabel={`I am at least ${MINIMUM_AGE} years old`}
              label={
                <Text variant="body">
                  I am at least {MINIMUM_AGE} years old.{' '}
                  <Text variant="caption" color="inkFaint">
                    (Self-declared — this app does not verify age.)
                  </Text>
                </Text>
              }
            />
            <CheckboxRow
              checked={termsOk}
              onToggle={() => setTermsOk((v) => !v)}
              accessibilityLabel="I agree to the Terms and Privacy Policy"
              label={
                <Text variant="body">
                  I agree to the{' '}
                  <Text variant="body" color="accent" weight="600" accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
                    Terms
                  </Text>{' '}
                  and{' '}
                  <Text variant="body" color="accent" weight="600" accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>
                    Privacy Policy
                  </Text>
                  .
                </Text>
              }
            />
          </View>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="success">{info}</Notice> : null}
        <Text variant="caption" color="inkFaint">
          A campus email shows you&apos;re a student — it isn&apos;t an identity check.
        </Text>
        <Button
          title={network ? 'Try again' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Verify'}
          onPress={submitCode}
          loading={busy}
          disabled={code.length !== 6 || !gateOk}
        />
        <Button
          title={left > 0 ? `Resend code in ${left}s` : 'Resend code'}
          variant="secondary"
          onPress={() => sendCode(true)}
          disabled={left > 0 || busy}
        />
        <Button
          title="Wrong email? Change it"
          variant="ghost"
          onPress={() => {
            setStep('email');
            setCode('');
            setError(undefined);
            setInfo(undefined);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {hideFirstHeading ? null : (
        <>
          <Text variant="title">Sign in or sign up</Text>
          <Text variant="body" color="inkMuted">
            Enter your @arizona.edu email. We’ll send you a 6-digit code — no password to remember.
          </Text>
        </>
      )}
      <Field
        label="Campus email"
        placeholder="you@arizona.edu"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setError(undefined);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        error={error}
        onSubmitEditing={() => sendCode(false)}
        returnKeyType="send"
        editable={!busy}
      />
      <Button title={network ? 'Try again' : submitLabel} onPress={() => sendCode(false)} loading={busy} />
      {onUsePhone ? <Button title="Use your phone number instead" variant="ghost" onPress={onUsePhone} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, width: '100%' },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  consent: {
    gap: space.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space.md,
  },
});

export default EmailAuthFlow;
