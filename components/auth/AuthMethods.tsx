/**
 * Picks the sign-in method to lead with, from `auth.methods`: email-first until
 * real SMS is live, phone-first after. A link swaps to the other method. While
 * the query loads we show a small placeholder (no flash of the wrong form); on
 * error we default to email-first.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { EMAIL_INTRO, EmailAuthFlow } from '@/components/auth/EmailAuthFlow';
import { PhoneAuthFlow } from '@/components/auth/PhoneAuthFlow';
import type { AuthFinish, AuthMode } from '@/components/auth/EmailAuthFlow';
import { trpc } from '@/lib/trpc';
import { space } from '@/constants/theme';

const PHONE_INTRO = 'Enter your mobile number. We’ll text you a 6-digit code — no password to remember.';

export function AuthMethods({
  onFinished,
  initialMethod,
  hideFirstHeading,
  cardIntro,
  mode,
}: {
  onFinished: (result: AuthFinish) => void;
  /** Create-account vs log-in (email flow). Unset = combined "sign in or sign up". */
  mode?: AuthMode;
  /** Force a method (e.g. `?method=phone`); otherwise the server's `primary`. */
  initialMethod?: 'email' | 'phone';
  hideFirstHeading?: boolean;
  /** Show the one-line explainer for the active method (used when the host card supplies the heading). */
  cardIntro?: boolean;
}) {
  const methods = trpc.auth.methods.useQuery(undefined, { retry: 1, staleTime: 60_000 });
  const [override, setOverride] = useState<'email' | 'phone' | undefined>(initialMethod);

  if (!override && methods.isPending) {
    return (
      <View style={styles.wrap} accessibilityLabel="Loading sign-in options" accessibilityLiveRegion="polite">
        <Skeleton height={28} width="60%" />
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Text variant="caption" color="inkFaint">
          Loading…
        </Text>
      </View>
    );
  }

  const primary = methods.data?.primary ?? 'email';
  const method = override ?? primary;
  // A simulated text never reaches a real phone, so outside local dev the phone
  // option only appears once the server reports real SMS delivery.
  const phoneUsable = __DEV__ || methods.data?.phone.simulated === false;

  return (
    <View style={styles.wrap}>
      {cardIntro ? (
        <Text variant="body" color="inkMuted">
          {method === 'email' ? EMAIL_INTRO : PHONE_INTRO}
        </Text>
      ) : null}
      {method === 'email' ? (
        <EmailAuthFlow
          onFinished={onFinished}
          hideFirstHeading={hideFirstHeading}
          submitLabel={cardIntro ? 'Email me a code' : undefined}
          mode={mode}
          onUsePhone={phoneUsable ? () => setOverride('phone') : undefined}
        />
      ) : (
        <PhoneAuthFlow
          onFinished={onFinished}
          hideFirstHeading={hideFirstHeading}
          onUseEmail={() => setOverride('email')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, width: '100%' },
});

export default AuthMethods;
