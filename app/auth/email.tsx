/**
 * Legacy route kept for old links. There is one sign-in screen, so this just
 * forwards to /auth/sign-in, carrying `returnTo` only when it was given.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function EmailSignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return <Redirect href={returnTo ? { pathname: '/auth/sign-in', params: { returnTo } } : '/auth/sign-in'} />;
}
