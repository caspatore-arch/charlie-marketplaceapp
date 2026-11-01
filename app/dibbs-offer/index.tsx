/**
 * "Your Dibbs offer requests" (route `/dibbs-offer`): the seller's private
 * requests to the Dibbs buying team, newest first, with a "Your turn" badge
 * when the team is waiting on an answer. Never shown to anyone else.
 */
import React, { useEffect } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { RefetchBanner } from '@/components/ui/RefetchBanner';
import { Skeleton } from '@/components/ui/Skeleton';
import { estimateText, statusCopy, type DibbsOfferSummary } from '@/components/dibbs/status';
import { colors, radius, space } from '@/constants/theme';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { resolveMediaUrl, trpc } from '@/lib/trpc';
import { formatRelative } from '@/utils/format';

const SHOWS_ESTIMATE = ['offered', 'meetup_proposed', 'meetup_confirmed'];

export default function DibbsOfferRequestsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const requireAuth = useRequireAuth();

  useEffect(() => {
    if (status === 'signedOut') requireAuth('/dibbs-offer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const query = trpc.dibbsOffer.mine.useQuery(undefined, { enabled: status === 'signedIn' });
  const title = 'Dibbs offer requests';

  if (status !== 'signedIn' || query.isPending) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title }} />
        <View style={styles.skeletons}>
          <Skeleton height={96} />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      </Screen>
    );
  }
  if (query.isError && !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  const rows = query.data ?? [];

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshing={query.isRefetching}
        onRefresh={() => query.refetch()}
        ListHeaderComponent={
          <View style={styles.header}>
            {query.isError ? <RefetchBanner onRetry={() => query.refetch()} /> : null}
            <Text variant="title" accessibilityRole="header">
              Your Dibbs offer requests
            </Text>
            <Text variant="bodySm" color="inkMuted">
              Private requests to the Dibbs team. Only you and authorized Dibbs staff can see them.
            </Text>
            {rows.length > 0 ? (
              <Button title="New request" variant="secondary" onPress={() => router.push('/dibbs-offer/new')} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No requests yet"
            body="Send photos of something you want to sell, and the Dibbs team can send you an estimate. Nothing is posted publicly."
            actionLabel="Get a Dibbs offer"
            onAction={() => router.push('/dibbs-offer/new')}
          />
        }
        renderItem={({ item }) => <RequestRow item={item} onPress={() => router.push(`/dibbs-offer/${item.id}`)} />}
      />
    </Screen>
  );
}

function RequestRow({ item, onPress }: { item: DibbsOfferSummary; onPress: () => void }) {
  const copy = statusCopy({
    status: item.status,
    meetupProposedBy: item.sellerActionNeeded ? 'dibbs' : 'seller',
  });
  const estimate =
    SHOWS_ESTIMATE.includes(item.status) && item.estimateLowCents != null && item.estimateHighCents != null
      ? `Estimate ${estimateText(item.estimateLowCents, item.estimateHighCents)}, subject to inspection`
      : null;
  return (
    <Card
      onPress={onPress}
      style={styles.row}
      accessibilityLabel={`${item.itemName}. ${copy.label}.${item.sellerActionNeeded ? ' Your turn.' : ''} Opens the request.`}
    >
      {item.coverUrl ? (
        <Image
          source={{ uri: resolveMediaUrl(item.coverUrl) }}
          style={styles.cover}
          contentFit="cover"
          accessibilityLabel={`Photo of ${item.itemName}`}
        />
      ) : (
        <View style={styles.cover} />
      )}
      <View style={styles.info}>
        <Text variant="heading" numberOfLines={2}>
          {item.itemName}
        </Text>
        <View style={styles.badges}>
          <Badge kind="status" label={copy.label} tone={copy.tone} />
          {item.sellerActionNeeded ? <Badge kind="status" label="Your turn" tone="warning" /> : null}
        </View>
        {estimate ? (
          <Text variant="caption" color="inkMuted">
            {estimate}
          </Text>
        ) : null}
        <Text variant="caption" color="inkFaint">
          {`Updated ${formatRelative(item.updatedAt)}`}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: space.md, paddingTop: space.lg },
  list: { padding: space.lg, paddingBottom: space.huge, gap: space.md },
  header: { gap: space.md, marginBottom: space.sm },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  cover: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  info: { flex: 1, gap: space.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
