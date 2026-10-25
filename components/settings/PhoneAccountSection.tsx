/**
 * "Account & phone": phone (masked) + verified state with add/change flow,
 * campus email status + verification (reachable at /settings, which other
 * screens link to when the server refuses an action for an unverified campus),
 * and the transactional text-message switch.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/auth/Field';
import { Notice } from '@/components/auth/Notice';
import { CampusEmailVerify } from '@/components/auth/CampusEmailVerify';
import { SMS_CODES_NOTE } from '@/components/auth/SmsConsent';
import { describeError, formatPhoneInput, maskPhone, phoneProblem } from '@/components/auth/helpers';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';

function PhoneEditor({ hasPhone, onClose }: { hasPhone: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const requestMutation = trpc.auth.requestPhoneLinkCode.useMutation();
  const confirmMutation = trpc.auth.confirmPhoneLink.useMutation();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [simulated, setSimulated] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);

  const left = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [left]);

  async function send() {
    const problem = phoneProblem(phone);
    if (problem) return setError(problem);
    setError(undefined);
    try {
      const res = await requestMutation.mutateAsync({ phone: phone.trim() });
      setSimulated(res.simulated);
      const t = Date.now();
      setNow(t);
      setResendAt(t + res.resendAfterSeconds * 1000);
      setCode('');
      setStep('code');
    } catch (e) {
      setError(describeError(e, 'Could not send a code. Try again.').message);
    }
  }

  async function confirm() {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
    setError(undefined);
    try {
      await confirmMutation.mutateAsync({ phone: phone.trim(), code });
      await Promise.all([utils.auth.me.invalidate(), utils.user.contactSettings.invalidate()]);
      onClose();
    } catch (e) {
      setError(describeError(e, 'That code didn’t work. Try again.').message);
    }
  }

  return (
    <View style={styles.editor}>
      {step === 'phone' ? (
        <>
          <Field
            label={hasPhone ? 'New mobile number' : 'Mobile number'}
            placeholder="(520) 555-0123"
            value={phone}
            onChangeText={(v) => {
              setPhone(formatPhoneInput(v));
              setError(undefined);
            }}
            keyboardType="phone-pad"
            inputMode="tel"
            autoComplete="tel"
            textContentType="telephoneNumber"
            error={error}
            onSubmitEditing={send}
            returnKeyType="send"
            autoFocus
          />
          <Button title="Text me a code" onPress={send} loading={requestMutation.isPending} />
        </>
      ) : (
        <>
          <Text variant="body" color="inkMuted">
            We texted a 6-digit code to {phone.trim()}.
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
            error={error}
            onSubmitEditing={confirm}
            autoFocus
          />
          <Button
            title="Verify number"
            onPress={confirm}
            loading={confirmMutation.isPending}
            disabled={code.length !== 6}
          />
          <Button
            title={left > 0 ? `Resend code in ${left}s` : 'Resend code'}
            variant="secondary"
            onPress={send}
            disabled={left > 0 || requestMutation.isPending}
          />
          <Button title="Wrong number? Change it" variant="ghost" onPress={() => setStep('phone')} />
        </>
      )}
      <Button title="Cancel" variant="ghost" onPress={onClose} />
    </View>
  );
}

export interface PhoneAccountSectionProps {
  /**
   * 'verification' = phone + campus email only (Settings > Verification);
   * 'texts' = the text-message switch only (Settings > Notifications);
   * omitted = everything, as before.
   */
  part?: 'verification' | 'texts';
}

export function PhoneAccountSection({ part }: PhoneAccountSectionProps = {}) {
  const showVerification = part !== 'texts';
  const showTexts = part !== 'verification';
  const utils = trpc.useUtils();
  const settings = trpc.user.contactSettings.useQuery();
  const [editingPhone, setEditingPhone] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [smsError, setSmsError] = useState<string | undefined>();

  const smsMutation = trpc.user.updateSmsPreferences.useMutation({
    onSuccess: () => utils.user.contactSettings.invalidate(),
    onError: (e) => setSmsError(e.message),
  });

  if (settings.isPending) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={48} />
        <Skeleton height={48} />
      </View>
    );
  }
  if (settings.isError) {
    return <ErrorState message={settings.error.message} onRetry={() => settings.refetch()} />;
  }
  const s = settings.data;
  const canText = !!s.phone && s.phoneVerified;

  return (
    <View style={styles.wrap}>
      {showVerification ? (
        <>
      <Text variant="caption" color="inkMuted">
        Phone verified and campus email verified are two separate checks. Neither is an ID check.
      </Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text variant="label" color="inkMuted">
            Phone
          </Text>
          <Text variant="body">{s.phone ? maskPhone(s.phone) : 'No phone number yet'}</Text>
        </View>
        {s.phone && s.phoneVerified ? (
          <Badge kind="status" label="Phone verified" tone="success" />
        ) : s.phone ? (
          <Badge kind="status" label="Not verified" tone="warning" />
        ) : null}
      </View>
      {editingPhone ? (
        <PhoneEditor hasPhone={!!s.phone} onClose={() => setEditingPhone(false)} />
      ) : (
        <Button
          title={s.phone ? 'Change phone' : 'Add phone'}
          variant="secondary"
          onPress={() => setEditingPhone(true)}
          style={styles.left}
        />
      )}

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text variant="label" color="inkMuted">
            Campus email
          </Text>
          <Text variant="body">{s.campusEmailVerified && s.email ? s.email : 'Not added'}</Text>
        </View>
        {s.campusEmailVerified ? (
          <Badge kind="verified" />
        ) : (
          <Badge kind="status" label="Not verified" tone="warning" />
        )}
      </View>
      {s.campusEmailVerified ? (
        <Text variant="caption" color="inkFaint">
          Campus email verified. This is not an ID check.
        </Text>
      ) : verifyingEmail ? (
        <View style={styles.editor}>
          <CampusEmailVerify
            onDone={() => setVerifyingEmail(false)}
            onSkip={() => setVerifyingEmail(false)}
            skipLabel="Cancel"
            doneLabel="Done"
          />
        </View>
      ) : (
        <>
          {s.postingStatus === 'approved' ? (
            <Text variant="caption" color="inkFaint">
              Dibbs approved your account to sell without a campus email. That approval is not a campus,
              student or ID check.
            </Text>
          ) : s.postingStatus === 'blocked' ? (
            <Text variant="caption" color="inkFaint">
              Your account can’t buy, sell or post right now. Contact support.
            </Text>
          ) : (
            <Text variant="caption" color="inkFaint">
              Campus email verification is required to buy, sell, or post. It is not an ID check.
            </Text>
          )}
          {s.email ? (
            <Text variant="caption" color="inkFaint">
              You sign in with {s.email}. Once you verify a campus email, you’ll sign in with that one instead.
            </Text>
          ) : null}
          <Button
            title="Verify campus email"
            variant="secondary"
            onPress={() => setVerifyingEmail(true)}
            style={styles.left}
          />
        </>
      )}
        </>
      ) : null}

      {showTexts ? (
        <>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text variant="heading">Text message notifications</Text>
          <Text variant="caption" color="inkFaint">
            {canText
              ? 'Posting confirmations, booking confirmations, and a reminder 30 minutes before a meetup.'
              : 'Add and verify a phone number to turn on texts.'}
          </Text>
        </View>
        <Switch
          value={canText && s.smsOptIn}
          disabled={!canText || smsMutation.isPending}
          onValueChange={(v) => {
            setSmsError(undefined);
            smsMutation.mutate({ smsOptIn: v });
          }}
          accessibilityLabel="Text message notifications"
          trackColor={{ true: colors.accent, false: colors.line }}
          thumbColor={colors.white}
          ios_backgroundColor={colors.line}
          style={styles.switch}
        />
      </View>
      {smsError ? <Notice tone="error">{smsError}</Notice> : null}
      <Text variant="caption" color="inkFaint">
        {SMS_CODES_NOTE} Msg & data rates may apply. Reply STOP to opt out.
      </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 48 },
  rowText: { flex: 1, gap: 2 },
  left: { alignSelf: 'flex-start' },
  editor: { gap: space.md, padding: space.lg, backgroundColor: colors.surfaceMuted, borderRadius: 14 },
  switch: { minHeight: 48 },
});

export default PhoneAccountSection;
