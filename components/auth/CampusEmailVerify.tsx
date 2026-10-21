/**
 * Campus email verification for a signed-in (phone) account:
 * auth.requestEmailLinkCode -> auth.confirmEmailLink. Used by the sign-in
 * flow ("Verify your campus email", skippable) and by Settings.
 *
 * If the server answers `switchedAccount`, the person already had a Dibbs
 * account on that email; the phone moved to it and we must store the new token.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/auth/Field';
import { Notice } from '@/components/auth/Notice';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { describeError } from '@/components/auth/helpers';
import { space } from '@/constants/theme';

export const CAMPUS_EXPLAINER =
  "Your phone proves it's you. Your campus email proves you're a student — it's required to buy, sell, or post.";
export const SWITCHED_COPY =
  'We found your existing Dibbs account for that email and moved your phone number to it — your listings and meetups are all there.';

export interface CampusEmailVerifyProps {
  /** Called when the person taps Continue on the success screen. */
  onDone: () => void;
  /** When set, shows a skip button (e.g. "Browse first"). */
  onSkip?: () => void;
  skipLabel?: string;
  /** Show the "phone vs campus email" explainer paragraph. */
  showExplainer?: boolean;
  doneLabel?: string;
}

export function CampusEmailVerify({
  onDone,
  onSkip,
  skipLabel = 'Browse first',
  showExplainer = true,
  doneLabel = 'Continue',
}: CampusEmailVerifyProps) {
  const { applyToken } = useAuth();
  const utils = trpc.useUtils();
  const requestMutation = trpc.auth.requestEmailLinkCode.useMutation();
  const confirmMutation = trpc.auth.confirmEmailLink.useMutation();

  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [switched, setSwitched] = useState(false);
  const [network, setNetwork] = useState(false);

  async function sendCode(isResend = false) {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter your campus email address.');
      return;
    }
    setError(undefined);
    setInfo(undefined);
    try {
      await requestMutation.mutateAsync({ email: trimmed });
      setNetwork(false);
      setStep('code');
      if (isResend) setInfo('New code sent.');
    } catch (e) {
      const d = describeError(e, 'Could not send a code. Try again.');
      setNetwork(d.network);
      setError(d.message);
    }
  }

  async function confirm() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code.');
      return;
    }
    setError(undefined);
    setInfo(undefined);
    try {
      const res = await confirmMutation.mutateAsync({ email: email.trim(), code: code.trim() });
      if (res.switchedAccount && res.token) {
        await applyToken(res.token);
        setSwitched(true);
      } else {
        await utils.auth.me.invalidate();
      }
      await utils.user.contactSettings.invalidate();
      setNetwork(false);
      setStep('done');
    } catch (e) {
      const d = describeError(e, 'That code didn’t work. Try again.');
      setNetwork(d.network);
      setError(d.message);
    }
  }

  if (step === 'done') {
    return (
      <View style={styles.wrap}>
        <Notice tone="success">
          {switched ? SWITCHED_COPY : 'Campus email verified. You can now buy, sell, and post.'}
        </Notice>
        <Text variant="caption" color="inkFaint">
          Campus email verified means you control a school email address — it is not an identity check.
        </Text>
        <Button title={doneLabel} onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {showExplainer ? (
        <Text variant="body" color="inkMuted">
          {CAMPUS_EXPLAINER}
        </Text>
      ) : null}

      {step === 'email' ? (
        <>
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
            onSubmitEditing={() => sendCode()}
            returnKeyType="send"
            editable={!requestMutation.isPending}
          />
          <Button
            title={network ? 'Try again' : 'Email me a code'}
            onPress={() => sendCode()}
            loading={requestMutation.isPending}
          />
        </>
      ) : (
        <>
          <Text variant="body" color="inkMuted">
            We sent a 6-digit code to {email.trim()}. Development mode: no email is sent — the code is printed in
            the server log.
          </Text>
          <Field
            label="Email code"
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
            error={error}
            onSubmitEditing={confirm}
            returnKeyType="done"
            editable={!confirmMutation.isPending}
            autoFocus
          />
          {info ? <Notice tone="success">{info}</Notice> : null}
          <Button
            title={network ? 'Try again' : 'Verify email'}
            onPress={confirm}
            loading={confirmMutation.isPending}
            disabled={code.length !== 6}
          />
          <View style={styles.linkRow}>
            <Button
              title="Send a new code"
              variant="ghost"
              onPress={() => sendCode(true)}
              loading={requestMutation.isPending}
            />
            <Button
              title="Change email"
              variant="ghost"
              onPress={() => {
                setStep('email');
                setCode('');
                setError(undefined);
                setInfo(undefined);
              }}
            />
          </View>
        </>
      )}

      {onSkip ? <Button title={skipLabel} variant="ghost" onPress={onSkip} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, width: '100%' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});

export default CampusEmailVerify;
