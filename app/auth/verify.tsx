/**
 * Step 2 of sign-in: 6-digit code (+ optional display name on first sign-in).
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { space } from '@/constants/theme';

export default function VerifyCodeScreen() {
  const { email, returnTo } = useLocalSearchParams<{ email: string; returnTo?: string }>();
  const router = useRouter();
  const { signInWithCode } = useAuth();

  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from the server log.');
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

          <Button title="Verify" onPress={handleSubmit} loading={loading} style={styles.button} />
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
});
