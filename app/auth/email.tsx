/**
 * Campus-email sign-in as its own route (kept for old links). The flow lives in
 * <EmailAuthFlow>; "Use your phone number instead" goes to /auth/sign-in?method=phone.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { EmailAuthFlow } from '@/components/auth/EmailAuthFlow';
import { space } from '@/constants/theme';

export default function EmailSignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const router = useRouter();

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <EmailAuthFlow
          onFinished={() => router.replace((returnTo || '/') as never)}
          onUsePhone={() =>
            router.replace({ pathname: '/auth/sign-in', params: { returnTo: returnTo ?? '', method: 'phone' } })
          }
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingTop: space.xl, paddingBottom: space.huge },
});
