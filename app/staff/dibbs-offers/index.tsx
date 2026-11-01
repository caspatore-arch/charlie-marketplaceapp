/**
 * Dibbs buying team: queue of private "Get a Dibbs offer" requests.
 * Chips: Needs action (default), All open, Closed. Oldest waiting first (the
 * server orders it), pull to refresh, and a background refetch every 60 s while
 * the screen is focused. Staff only: the server refuses everyone else too.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useIsFocused, useRouter } from 'expo-router';
import { Inbox } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StaffGate } from '@/components/dibbs-staff/StaffGate';
import { QueueRow } from '@/components/dibbs-staff/QueueRow';
import type { StaffQueueRow } from '@/components/dibbs-staff/format';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';

type Filter = 'action' | 'open' | 'closed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'action', label: 'Needs action' },
  { key: 'open', label: 'All open' },
  { key: 'closed', label: 'Closed' },
];

const EMPTY: Record<Filter, { title: string; body: string }> = {
  action: { title: 'Nothing needs action', body: 'New requests and seller replies show up here.' },
  open: { title: 'No open requests', body: 'Requests that are still in progress show up here.' },
  closed: { title: 'No closed requests yet', body: 'Finished, declined and withdrawn requests show up here.' },
};

const POLL_MS = 60_000;

export default function DibbsOfferQueueScreen() {
  return (
    <StaffGate returnTo="/staff/dibbs-offers">
      <Stack.Screen options={{ title: 'Dibbs offers' }} />
      <Queue />
    </StaffGate>
  );
}

function Queue() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const [filter, setFilter] = useState<Filter>('action');
  const [refreshing, setRefreshing] = useState(false);

  const query = trpc.dibbsStaff.queue.useQuery({ filter }, { refetchInterval: isFocused ? POLL_MS : false });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  const header = (
    <View style={styles.header}>
      <Text variant="caption" color="inkMuted">
        Dibbs buying team · Private requests
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Filter requests">
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
    </View>
  );

  if (query.isPending) {
    return (
      <Screen>
        {header}
        <View style={styles.loading}>
          <Skeleton height={110} radius={20} />
          <Skeleton height={110} radius={20} />
          <Skeleton height={110} radius={20} />
        </View>
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen>
        {header}
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList<StaffQueueRow>
        data={query.data}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <QueueRow row={item} onPress={() => router.push(`/staff/dibbs-offers/${item.id}` as never)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon={<Inbox size={40} color={colors.inkFaint} />}
            title={EMPTY[filter].title}
            body={EMPTY[filter].body}
          />
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.md, paddingTop: space.md, paddingBottom: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  loading: { gap: space.md },
  list: { paddingBottom: space.huge },
  gap: { height: space.md },
});
