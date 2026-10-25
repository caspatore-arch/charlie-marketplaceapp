/**
 * Sign-in. <AuthMethods> leads with email (or phone once SMS is live);
 * this screen is the page chrome plus the `returnTo` / `method` handling.
 *
 * The chrome lives in <AuthScreenShell> so this route and /auth/email stay
 * identical. `hideFirstHeading` + `cardIntro` hand the heading to the shell and
 * let the flow supply its one-line explainer, the same pairing the welcome
 * screen uses.
 */
import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { AuthMethods } from '@/components/auth/AuthMethods';
import { TextLink } from '@/components/ui/TextLink';
import { safeReturnTo } from '@/components/auth/helpers';
import type { AuthFinish } from '@/components/auth/EmailAuthFlow';
import { space } from '@/constants/theme';

export default function SignInScreen() {
  const { returnTo, method } = useLocalSearchParams<{ returnTo?: string; method?: string }>();
  const router = useRouter();

  // A brand-new account makes its profile first; everyone else goes back to
  // where they were.
  const finish = ({ isNewAccount }: AuthFinish) =>
    router.replace((isNewAccount ? '/create-profile' : safeReturnTo(returnTo)) as never);

  return (
    <AuthScreenShell title="Sign in or sign up">
      <AuthMethods
        hideFirstHeading
        cardIntro
        onFinished={finish}
        initialMethod={method === 'phone' || method === 'email' ? method : undefined}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg }}>
        <TextLink href="/about" variant="small">What is Dibbs?</TextLink>
        <TextLink href="/why-dibbs" variant="small">Why use Dibbs?</TextLink>
      </View>
    </AuthScreenShell>
  );
}
