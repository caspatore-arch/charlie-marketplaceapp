/**
 * Public profile screen: user.byId + listing.bySeller, with Report and Block
 * actions (each behind a confirm dialog).
 */
import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { DemoBadge } from '@/components/DemoBadge';
import { TrustBlock } from '@/components/TrustSignals';
import { trpc } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { space } from '@/constants/theme';
import { confirmAction } from '@/utils/confirm';

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const requireAuth = useRequireAuth();

  const profileQuery = trpc.user.byId.useQuery({ id }, { enabled: !!id });
  const trustQuery = trpc.user.trustSummary.useQuery({ id }, { enabled: !!id });
  const listingsQuery = trpc.listing.bySeller.useQuery({ sellerId: id }, { enabled: !!id });

  const blockMutation = trpc.user.block.useMutation();
  const reportMutation = trpc.user.report.useMutation();

  const confirmBlock = useCallback(() => {
    if (!requireAuth(`/user/${id}`)) return;
    confirmAction(
      'Block this user?',
      'They will no longer be able to message or request meetups with you.',
      'Block',
      () => blockMutation.mutate({ userId: id }),
    );
  }, [requireAuth, id, blockMutation]);

  const confirmReport = useCallback(() => {
    if (!requireAuth(`/user/${id}`)) return;
    confirmAction(
      'Report this user?',
      "We'll review this account for platform violations.",
      'Report',
      () => reportMutation.mutate({ targetUserId: id, reason: 'other' }),
    );
  }, [requireAuth, id, reportMutation]);

  if (profileQuery.isPending) {
    return (
      <Screen>
        <View style={styles.header}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width={140} height={20} />
        </View>
      </Screen>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <Screen>
        <ErrorState message={profileQuery.error?.message ?? 'This profile could not be found.'} onRetry={() => profileQuery.refetch()} />
      </Screen>
    );
  }

  const profile = profileQuery.data;
  const isSelf = user?.id === profile.id;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Avatar uri={profile.avatarUrl} name={profile.displayName} size={72} />
        <Text variant="title">{profile.displayName}</Text>
        {/* Member-since lives in the trust block below, to the month. Repeating
            a vaguer year here read as two different facts about one person. */}
        <Text variant="body" color="inkMuted">
          {profile.campus?.name}
        </Text>
        <View style={styles.badgeRow}>
          {profile.campusEmailVerified ? <Badge kind="verified" /> : null}
          <DemoBadge visible={profile.isDemo} />
        </View>
        {profile.bio ? (
          <Text variant="body" style={styles.bio}>
            {profile.bio}
          </Text>
        ) : null}
      </View>

      {trustQuery.isPending ? (
        <Skeleton height={140} radius={20} style={styles.trustBlock} />
      ) : trustQuery.data ? (
        <TrustBlock summary={trustQuery.data} style={styles.trustBlock} />
      ) : null}

      {!isSelf ? (
        <View style={styles.actions}>
          <Button title="Report" variant="secondary" onPress={confirmReport} style={styles.actionBtn} />
          <Button title="Block" variant="danger" onPress={confirmBlock} style={styles.actionBtn} />
        </View>
      ) : null}

      <Text variant="heading" style={styles.listingsTitle}>
        Listings
      </Text>
      {listingsQuery.isPending ? (
        <Skeleton height={180} />
      ) : listingsQuery.isError ? (
        <ErrorState message={listingsQuery.error.message} onRetry={() => listingsQuery.refetch()} />
      ) : (listingsQuery.data ?? []).length === 0 ? (
        <EmptyState title="No listings yet" />
      ) : (
        <FlatList
          data={listingsQuery.data}
          keyExtractor={(item) => item.id}
          numColumns={2}
          scrollEnabled={false}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item }) => (
            <View style={styles.gridCell}>
              <ListingCard
                listing={item}
                onPress={() => router.push(`/listing/${item.id}`)}
                showSeller={false}
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  badgeRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  bio: { textAlign: 'center', marginTop: space.md, paddingHorizontal: space.lg },
  trustBlock: { marginTop: space.lg, marginBottom: space.lg },
  actions: { flexDirection: 'row', gap: space.md, marginBottom: space.xl },
  actionBtn: { flex: 1 },
  listingsTitle: { marginBottom: space.md },
  gridRow: { gap: space.md },
  // maxWidth pins a lone cell to half the row. With numColumns={2} a flex:1
  // cell stretches to the full width whenever a row is short — one search
  // result rendered as a single giant card.
  gridCell: { flex: 1, maxWidth: '50%' },
});
