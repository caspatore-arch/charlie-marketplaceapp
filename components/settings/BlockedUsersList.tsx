/**
 * Blocked users list with unblock action. Self-contained (owns its own
 * query + mutation) so it can be dropped into the Settings screen without
 * duplicating the list logic that used to live on the Profile screen.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';
import type { PublicProfile } from '@/types';

export function BlockedUsersList() {
  const blockedQuery = trpc.user.blocked.useQuery();
  const unblockMutation = trpc.user.unblock.useMutation({
    onSuccess: () => blockedQuery.refetch(),
  });

  if (blockedQuery.isPending) {
    return <Skeleton height={48} />;
  }

  if (blockedQuery.isError) {
    return <ErrorState message={blockedQuery.error.message} onRetry={() => blockedQuery.refetch()} />;
  }

  if ((blockedQuery.data ?? []).length === 0) {
    return (
      <Text variant="body" color="inkMuted">
        You haven&apos;t blocked anyone.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {blockedQuery.data!.map((u: PublicProfile) => (
        <View key={u.id} style={styles.row}>
          <Text variant="body" style={styles.name} accessibilityLabel={`Blocked: ${u.displayName}`}>
            {u.displayName}
          </Text>
          <Button
            title="Unblock"
            variant="secondary"
            onPress={() => unblockMutation.mutate({ userId: u.id })}
            loading={unblockMutation.isPending && unblockMutation.variables?.userId === u.id}
            accessibilityLabel={`Unblock ${u.displayName}`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  name: { flex: 1 },
});

export default BlockedUsersList;
