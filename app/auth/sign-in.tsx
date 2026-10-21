/**
 * Phone-first sign-in. The whole flow (number -> code -> profile for new
 * numbers -> optional campus email) lives in <PhoneAuthFlow>; this screen is
 * the page chrome plus the `returnTo` handling.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PhoneAuthFlow } from '@/components/auth/PhoneAuthFlow';
import { space } from '@/constants/theme';

export default function SignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const router = useRouter();

  const finish = () => router.replace((returnTo || '/') as never);

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <PhoneAuthFlow
          onFinished={finish}
          onUseEmail={() => router.push({ pathname: '/auth/email', params: { returnTo: returnTo ?? '' } })}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, paddingTop: space.xl, paddingBottom: space.huge },
});
