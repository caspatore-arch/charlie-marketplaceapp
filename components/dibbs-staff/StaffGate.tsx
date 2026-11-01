/**
 * Wraps a staff screen: waits for auth, sends signed-out people to sign-in with
 * a return path (so an emailed link to /staff/dibbs-offers/<id> comes back here
 * after sign-in), and shows "Staff only" to anyone not on the buying team. The
 * server refuses non-staff calls too; this only avoids showing a dead screen.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';

export function StaffGate({ returnTo, children }: { returnTo: string; children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const redirected = useRef(false);

  const signedIn = status === 'signedIn';
  const amI = trpc.dibbsStaff.amI.useQuery(undefined, { enabled: signedIn });

  useEffect(() => {
    if (status === 'signedOut' && !redirected.current) {
      redirected.current = true;
      router.push({ pathname: '/auth/sign-in', params: { returnTo } });
    }
  }, [status, router, returnTo]);

  if (status === 'loading' || (signedIn && amI.isPending)) {
    return (
      <Screen>
        <View style={styles.loading}>
          <Skeleton height={44} radius={12} />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      </Screen>
    );
  }

  if (status === 'signedOut') {
    return (
      <Screen>
        <EmptyState
          icon={<Lock size={40} color={colors.inkFaint} />}
          title="Sign in to continue"
          body="The Dibbs buying team screens need a signed-in staff account."
          actionLabel="Sign in"
          onAction={() => router.push({ pathname: '/auth/sign-in', params: { returnTo } })}
        />
      </Screen>
    );
  }

  if (amI.isError) {
    return (
      <Screen>
        <ErrorState message={amI.error.message} onRetry={() => amI.refetch()} />
      </Screen>
    );
  }

  if (!amI.data?.isStaff) {
    return (
      <Screen>
        <EmptyState
          icon={<Lock size={40} color={colors.inkFaint} />}
          title="Staff only"
          body="This section is for the Dibbs buying team."
        />
      </Screen>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loading: { gap: space.md, paddingTop: space.lg },
});

export default StaffGate;
