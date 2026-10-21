/**
 * Campus-email sign-in as its own route (kept for old links). The flow lives in
 * <EmailAuthFlow>; "Use your phone number instead" goes to /auth/sign-in?method=phone.
 *
 * Shares <AuthScreenShell> with /auth/sign-in so an old link does not land on a
 * differently-branded page than the current one.
 */
import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { EmailAuthFlow } from '@/components/auth/EmailAuthFlow';

export default function EmailSignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const router = useRouter();

  return (
    <AuthScreenShell title="Sign in or sign up">
      <EmailAuthFlow
        hideFirstHeading
        submitLabel="Email me a code"
        onFinished={() => router.replace((returnTo || '/') as never)}
        onUsePhone={() =>
          router.replace({ pathname: '/auth/sign-in', params: { returnTo: returnTo ?? '', method: 'phone' } })
        }
      />
    </AuthScreenShell>
  );
}
