/**
 * Phone-first sign-in as one small state machine, reused by /auth/sign-in
 * (screen) and the sign-up card on /welcome:
 *   phone -> code -> (new number) profile -> campusEmail (if not verified) -> onFinished
 * Codes are always real SMS in production; in development they are printed to
 * the server log and the UI says so (`simulated`).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Field } from '@/components/auth/Field';
import { Notice } from '@/components/auth/Notice';
import { CheckboxRow } from '@/components/auth/CheckboxRow';
import { CampusEmailVerify } from '@/components/auth/CampusEmailVerify';
import { SMS_CONSENT_TEXT } from '@/components/auth/SmsConsent';
import { describeError, formatPhoneInput, phoneProblem, secondsFromMessage } from '@/components/auth/helpers';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { MINIMUM_AGE } from '@/constants/legal';
import { colors, radius, space } from '@/constants/theme';
import type { AuthFinish } from '@/components/auth/EmailAuthFlow';

type Step = 'phone' | 'code' | 'profile' | 'campusEmail';

export interface PhoneAuthFlowProps {
  /** Called when the flow is complete (signed in, and verified or skipped). */
  onFinished: (result: AuthFinish) => void;
  /** Called for "Use campus email instead". */
  onUseEmail?: () => void;
  /** Heading shown on the first step. */
  phoneTitle?: string;
  phoneSubtitle?: string;
  /** Hide step headings (the host card already has one). */
  hideFirstHeading?: boolean;
  /** Button label on the first step. */
  submitLabel?: string;
}

export function PhoneAuthFlow({
  onFinished,
  onUseEmail,
  phoneTitle = 'Sign in or sign up',
  phoneSubtitle = 'Enter your mobile number. We’ll text you a 6-digit code — no password.',
  hideFirstHeading,
  submitLabel = 'Text me a code',
}: PhoneAuthFlowProps) {
  const router = useRouter();
  const { requestPhoneCode, verifyPhoneCode } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  // Set once the profile step creates the account, so the host can route a
  // brand-new user to profile setup.
  const [createdAccount, setCreatedAccount] = useState(false);
  const finish = (isNew = createdAccount) => onFinished({ isNewAccount: isNew });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [simulated, setSimulated] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [network, setNetwork] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [campusId, setCampusId] = useState<string | undefined>();
  const [smsOptIn, setSmsOptIn] = useState(false); // unchecked by default
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);

  const campusesQuery = trpc.campus.list.useQuery(undefined, { enabled: step === 'profile' });

  // One-second ticker only while the resend countdown is running.
  const counting = step === 'code' && resendAt > now;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const fail = useCallback((e: unknown, fallback: string) => {
    const d = describeError(e, fallback);
    setNetwork(d.network);
    setError(d.message);
    return d;
  }, []);

  function startCooldown(seconds: number) {
    const t = Date.now();
    setNow(t);
    setResendAt(t + seconds * 1000);
  }

  async function sendCode(isResend: boolean) {
    const problem = phoneProblem(phone);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const res = await requestPhoneCode(phone.trim());
      setNetwork(false);
      setSimulated(res.simulated);
      startCooldown(res.resendAfterSeconds);
      setCode('');
      setStep('code');
      if (isResend) setInfo('New code sent.');
    } catch (e) {
      const d = fail(e, 'Could not send a code. Try again.');
      if (d.code === 'TOO_MANY_REQUESTS') {
        const secs = secondsFromMessage(d.message);
        if (secs && step === 'code') startCooldown(Math.min(secs, 3600));
      }
    } finally {
      setBusy(false);
    }
  }

  function afterSignedIn(campusEmailVerified: boolean, isNew = false) {
    if (isNew) setCreatedAccount(true);
    if (campusEmailVerified) finish(isNew);
    else setStep('campusEmail');
  }

  async function submitCode() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const res = await verifyPhoneCode({ phone: phone.trim(), code: code.trim() });
      setNetwork(false);
      if (res.status === 'needs_profile') setStep('profile');
      else afterSignedIn(!!res.user.campusEmailVerifiedAt);
    } catch (e) {
      fail(e, 'That code didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitProfile() {
    if (!displayName.trim()) return setError('Enter your name.');
    if (!effectiveCampusId) return setError('Pick your campus.');
    if (!ageOk || !termsOk) {
      return setError('Confirm your age and agree to the Terms and Privacy Policy to create an account.');
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await verifyPhoneCode({
        phone: phone.trim(),
        code: code.trim(),
        displayName: displayName.trim(),
        campusId: effectiveCampusId,
        smsOptIn,
      });
      setNetwork(false);
      if (res.status === 'needs_profile') setError('Something went wrong. Please try again.');
      else afterSignedIn(!!res.user.campusEmailVerifiedAt, true);
    } catch (e) {
      fail(e, 'Could not create your account. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const campuses = campusesQuery.data;
  const effectiveCampusId = campusId ?? (campuses && campuses.length === 1 ? campuses[0]!.id : undefined);

  const tryAgain = network;
  const phoneLabel = useMemo(() => phone.trim(), [phone]);

  if (step === 'campusEmail') {
    return (
      <View style={styles.wrap}>
        <Text variant="title">Verify your campus email</Text>
        <CampusEmailVerify onDone={() => finish()} onSkip={() => finish()} skipLabel="Browse first" />
      </View>
    );
  }

  if (step === 'profile') {
    return (
      <View style={styles.wrap}>
        <Text variant="title">Set up your account</Text>
        <Text variant="body" color="inkMuted">
          Your number is confirmed. Tell us your name and campus.
        </Text>
        <Field
          label="Display name"
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
          returnKeyType="next"
          editable={!busy}
        />

        <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Campus">
          <Text variant="label" color="inkMuted">
            Campus
          </Text>
          {campusesQuery.isPending ? (
            <Skeleton height={48} />
          ) : campusesQuery.isError ? (
            <View style={styles.wrap}>
              <Notice tone="error">{campusesQuery.error.message}</Notice>
              <Button title="Try again" variant="secondary" onPress={() => campusesQuery.refetch()} />
            </View>
          ) : (
            campuses?.map((c) => {
              const selected = effectiveCampusId === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setCampusId(c.id);
                    setError(undefined);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={c.name}
                  style={[styles.option, selected ? styles.optionSelected : null]}
                >
                  <View style={[styles.radio, selected ? styles.radioOn : null]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text variant="body" weight={selected ? '600' : '400'}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.consent}>
          <CheckboxRow
            checked={smsOptIn}
            onToggle={() => setSmsOptIn((v) => !v)}
            accessibilityLabel={SMS_CONSENT_TEXT}
            label={<Text variant="body">{SMS_CONSENT_TEXT}</Text>}
          />
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

        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button
          title={tryAgain ? 'Try again' : 'Create account'}
          onPress={submitProfile}
          loading={busy}
          disabled={campusesQuery.isPending}
        />
        <Button
          title="Back to code"
          variant="ghost"
          onPress={() => {
            setStep('code');
            setError(undefined);
          }}
        />
      </View>
    );
  }

  if (step === 'code') {
    return (
      <View style={styles.wrap}>
        <Text variant="title">Enter your code</Text>
        <Text variant="body" color="inkMuted">
          We texted a 6-digit code to {phoneLabel}.
        </Text>
        {simulated ? (
          <Notice tone="dev">Development mode: no text is sent — the code is printed in the server log.</Notice>
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
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          autoFocus
          error={error}
          onSubmitEditing={submitCode}
          returnKeyType="done"
          editable={!busy}
          style={styles.codeInput}
        />
        {info ? <Notice tone="success">{info}</Notice> : null}
        <Button
          title={tryAgain ? 'Try again' : 'Verify'}
          onPress={submitCode}
          loading={busy}
          disabled={code.length !== 6}
        />
        <Button
          title={secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
          variant="secondary"
          onPress={() => sendCode(true)}
          disabled={secondsLeft > 0 || busy}
        />
        <Button
          title="Wrong number? Change it"
          variant="ghost"
          onPress={() => {
            setStep('phone');
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
          <Text variant="title">{phoneTitle}</Text>
          <Text variant="body" color="inkMuted">
            {phoneSubtitle}
          </Text>
        </>
      )}
      <Field
        label="Mobile number"
        placeholder="(520) 555-0123"
        helper="US numbers: 10 digits. Other countries: start with + and the country code."
        value={phone}
        onChangeText={(v) => {
          setPhone(formatPhoneInput(v));
          setError(undefined);
        }}
        keyboardType="phone-pad"
        inputMode="tel"
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoCorrect={false}
        error={error}
        onSubmitEditing={() => sendCode(false)}
        returnKeyType="send"
        editable={!busy}
      />
      <Button title={tryAgain ? 'Try again' : submitLabel} onPress={() => sendCode(false)} loading={busy} />
      {onUseEmail ? (
        <Button title="Use campus email instead" variant="link" onPress={onUseEmail} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, width: '100%' },
  group: { gap: space.sm },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  consent: {
    gap: space.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});

export default PhoneAuthFlow;
