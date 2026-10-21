/**
 * Sign-in. <AuthMethods> leads with campus email (or phone once SMS is live);
 * this screen is the page chrome plus the `returnTo` / `method` handling.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { AuthMethods } from '@/components/auth/AuthMethods';
import { space } from '@/constants/theme';

export default function SignInScreen() {
  const { returnTo, method } = useLocalSearchParams<{ returnTo?: string; method?: string }>();
  const router = useRouter();

  const finish = () => router.replace((returnTo || '/') as never);

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <AuthMethods
          onFinished={finish}
          initialMethod={method === 'phone' || method === 'email' ? method : undefined}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingTop: space.xl, paddingBottom: space.huge },
});
