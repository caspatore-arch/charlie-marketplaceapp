/** Old code screen; the code step now lives inside <EmailAuthFlow>. Kept so stale links still land somewhere sensible. */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function VerifyCodeScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return <Redirect href={{ pathname: '/auth/email', params: { returnTo: returnTo ?? '' } }} />;
}
