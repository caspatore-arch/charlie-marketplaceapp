/**
 * Sign-in. <AuthMethods> leads with campus email (or phone once SMS is live);
 * this screen is the page chrome plus the `returnTo` / `method` handling.
 *
 * The chrome lives in <AuthScreenShell> so this route and /auth/email stay
 * identical. `hideFirstHeading` + `cardIntro` hand the heading to the shell and
 * let the flow supply only its one-line explainer — the same pairing the
 * welcome screen uses, so the card reads the same wherever it appears.
 */
import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { AuthMethods } from '@/components/auth/AuthMethods';
import type { AuthFinish } from '@/components/auth/EmailAuthFlow';

export default function SignInScreen() {
  const { returnTo, method } = useLocalSearchParams<{ returnTo?: string; method?: string }>();
  const router = useRouter();

  // A brand-new account makes its profile first; everyone else goes back to
  // where they were.
  const finish = ({ isNewAccount }: AuthFinish) =>
    router.replace((isNewAccount ? '/create-profile' : returnTo || '/') as never);

  return (
    <AuthScreenShell title="Sign in or sign up">
      <AuthMethods
        hideFirstHeading
        cardIntro
        onFinished={finish}
        initialMethod={method === 'phone' || method === 'email' ? method : undefined}
      />
    </AuthScreenShell>
  );
}
