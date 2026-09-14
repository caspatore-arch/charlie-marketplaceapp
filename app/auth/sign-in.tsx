/**
 * Step 1 of sign-in: campus email -> request a code. The code itself is
 * printed to the server console in this prototype (no real email is sent).
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

export default function SignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const router = useRouter();
  const { requestCode } = useAuth();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your campus email.');
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await requestCode(trimmed);
      router.push({ pathname: '/auth/verify', params: { email: trimmed, returnTo: returnTo ?? '' } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send a code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text variant="title" style={styles.title}>
            Sign in
          </Text>
          <Text variant="body" color="inkMuted" style={styles.subtitle}>
            Enter your campus email. This prototype doesn&apos;t send real email — your
            sign-in code is printed to the server log instead.
          </Text>

          <Input
            label="Campus email"
            placeholder="you@arizona.edu"
            value={email}
            onChangeText={setEmail}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            error={error}
            onSubmitEditing={handleSubmit}
            returnKeyType="send"
          />

          <Button title="Send code" onPress={handleSubmit} loading={loading} style={styles.button} />
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
