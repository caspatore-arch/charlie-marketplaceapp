/**
 * Step 2 of sign-in: 6-digit code (+ optional display name on first sign-in).
 *
 * Eligibility gate: this screen is also where a brand-new account gets
 * created (the backend creates the user record here if the email hasn't
 * signed in before — see backend/trpc/routes/auth.ts `verifyCode`). The
 * client can't know in advance whether a given email is new, so the gate
 * uses the same signal a human would: typing a display name means "I'm
 * setting up my account for the first time." The checkboxes only appear,
 * and are only required, once the display-name field has text in it.
 *
 * This is deliberately loose, not airtight — an existing user who happens
 * to retype their display name would also see the gate. That's an
 * acceptable trade-off for a prototype because it errs toward showing the
 * gate rather than skipping it, and it keeps the one hard requirement:
 * zero extra taps for the dev "Switch test user" path (a separate function,
 * `devSignIn`, that never touches this screen) and for existing users who
 * sign in without touching the display-name field.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { colors, radius, space } from '@/constants/theme';
import { MINIMUM_AGE } from '@/app/legal/content';

function CheckboxRow({
  checked,
  onToggle,
  label,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.checkboxRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <View style={[styles.checkbox, checked ? styles.checkboxChecked : null]}>
        {checked ? <View style={styles.checkboxDot} /> : null}
      </View>
      <View style={styles.checkboxLabel}>{label}</View>
    </Pressable>
  );
}

export default function VerifyCodeScreen() {
  const { email, returnTo } = useLocalSearchParams<{ email: string; returnTo?: string }>();
  const router = useRouter();
  const { signInWithCode } = useAuth();

  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  // Only a first-time signup (signalled by a non-empty display name) needs
  // to clear the eligibility gate. Existing users leave this blank and see
  // no extra UI and no extra taps.
  const isSigningUp = displayName.trim().length > 0;
  const gateSatisfied = !isSigningUp || (ageConfirmed && agreedToTerms);

  async function handleSubmit() {
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from the server log.');
      return;
    }
    if (isSigningUp && !gateSatisfied) {
      setError('Confirm your age and agree to the Terms and Privacy Policy to create an account.');
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await signInWithCode(email, code.trim(), displayName.trim() || undefined);
      if (returnTo) {
        router.replace(returnTo as never);
      } else {
        router.replace('/');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code didn’t work. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.content}>
          <Text variant="title" style={styles.title}>
            Enter your code
          </Text>
          <Text variant="body" color="inkMuted" style={styles.subtitle}>
            We printed a 6-digit code to the server console for {email}. Check the
            backend terminal running `npm run backend`.
          </Text>

          <Input
            label="Code"
            placeholder="123456"
            value={code}
            onChangeText={setCode}
            autoFocus
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            error={error}
          />

          <Input
            label="Display name (first sign-in only)"
            placeholder="e.g. Maya"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />

          {isSigningUp ? (
            <View style={styles.gate}>
              <CheckboxRow
                checked={ageConfirmed}
                onToggle={() => setAgeConfirmed((v) => !v)}
                accessibilityLabel={`I am at least ${MINIMUM_AGE} years old`}
                label={
                  <Text variant="body" color="ink">
                    I am at least {MINIMUM_AGE} years old.{' '}
                    <Text variant="caption" color="inkFaint">
                      (Self-declared — this app does not verify age.)
                    </Text>
                  </Text>
                }
              />
              <CheckboxRow
                checked={agreedToTerms}
                onToggle={() => setAgreedToTerms((v) => !v)}
                accessibilityLabel="I agree to the Terms and Privacy Policy"
                label={
                  <Text variant="body" color="ink">
                    I agree to the{' '}
                    <Text
                      variant="body"
                      color="accent"
                      weight="600"
                      onPress={() => router.push('/legal/terms')}
                      accessibilityRole="link"
                    >
                      Terms
                    </Text>{' '}
                    and{' '}
                    <Text
                      variant="body"
                      color="accent"
                      weight="600"
                      onPress={() => router.push('/legal/privacy')}
                      accessibilityRole="link"
                    >
                      Privacy Policy
                    </Text>
                    .
                  </Text>
                }
              />
            </View>
          ) : null}

          <Button
            title="Verify"
            onPress={handleSubmit}
            loading={loading}
            disabled={isSigningUp && !gateSatisfied}
            style={styles.button}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: space.xl, gap: space.md },
  title: { marginBottom: space.xs },
  subtitle: { marginBottom: space.lg },
  button: { marginTop: space.sm },
  gate: {
    gap: space.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space.md,
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkboxDot: { width: 10, height: 10, borderRadius: 3, backgroundColor: colors.white },
  checkboxLabel: { flex: 1 },
});
