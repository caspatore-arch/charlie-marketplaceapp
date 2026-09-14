/**
 * Inbox tab: two segments — Messages (conversation.list) and Requests
 * (reservation.mine, grouped "As buyer" / "As seller"). Requires auth; polls
 * every 10s while focused as a stand-in for push notifications.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, useIsFocused } from 'expo-router';
import { MessageCircle, Inbox as InboxIcon } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Divider } from '@/components/ui/Divider';
import { SegmentedTabs } from '@/components/inbox/SegmentedTabs';
import { ConversationRow } from '@/components/inbox/ConversationRow';
import { ReservationRow } from '@/components/inbox/ReservationRow';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';
import type { ConversationSummary, ReservationDetail } from '@/types';

const POLL_MS = 10_000;

type Tab = 'messages' | 'requests';

export default function InboxScreen() {
  const { status } = useAuth();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <Screen>
        <View style={styles.loadingWrap}>
          <Skeleton height={44} radius={12} />
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      </Screen>
    );
  }

  if (status === 'signedOut') {
    return (
      <Screen>
        <EmptyState
          icon={<MessageCircle size={40} color={colors.inkFaint} />}
          title="Sign in to see your inbox"
          body="Messages with buyers and sellers, and your meetup requests, show up here."
          actionLabel="Sign in"
          onAction={() => router.push('/auth/sign-in')}
        />
      </Screen>
    );
  }

  return <SignedInInbox />;
}

function SignedInInbox() {
  const [tab, setTab] = useState<Tab>('messages');
  const router = useRouter();
  const isFocused = useIsFocused();
  const { user } = useAuth();

  const conversationsQuery = trpc.conversation.list.useQuery(undefined, {
    refetchInterval: isFocused ? POLL_MS : false,
  });
  const reservationsQuery = trpc.reservation.mine.useQuery(
    {},
    { refetchInterval: isFocused ? POLL_MS : false },
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([conversationsQuery.refetch(), reservationsQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [conversationsQuery, reservationsQuery]);

  const unreadCount = useMemo(
    () => (conversationsQuery.data ?? []).reduce((sum, c) => sum + (c.unreadCount > 0 ? 1 : 0), 0),
    [conversationsQuery.data],
  );
  const needsReplyCount = useMemo(() => {
    if (!user) return 0;
    return (reservationsQuery.data ?? []).filter(
      (r) => (r.status === 'requested' || r.status === 'countered') && r.proposedById !== user.id,
    ).length;
  }, [reservationsQuery.data, user]);

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text variant="title">Inbox</Text>
      </View>
      <View style={styles.tabsWrap}>
        <SegmentedTabs
          segments={[
            { key: 'messages', label: 'Messages', badge: unreadCount || undefined },
            { key: 'requests', label: 'Requests', badge: needsReplyCount || undefined },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'messages' ? (
        <MessagesList
          data={conversationsQuery.data}
          isPending={conversationsQuery.isPending}
          isError={conversationsQuery.isError}
          errorMessage={conversationsQuery.error?.message}
          onRetry={() => conversationsQuery.refetch()}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onPress={(id) => router.push(`/conversation/${id}`)}
        />
      ) : (
        <RequestsList
          data={reservationsQuery.data}
          isPending={reservationsQuery.isPending}
          isError={reservationsQuery.isError}
          errorMessage={reservationsQuery.error?.message}
          onRetry={() => reservationsQuery.refetch()}
          viewerId={user?.id ?? ''}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onPress={(id) => router.push(`/reservation/${id}`)}
        />
      )}
    </Screen>
  );
}

function MessagesList({
  data,
  isPending,
  isError,
  errorMessage,
  onRetry,
  refreshing,
  onRefresh,
  onPress,
}: {
  data: ConversationSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  onPress: (id: string) => void;
}) {
  if (isPending) {
    return (
      <View style={styles.listContent}>
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </View>
    );
  }

  if (isError) {
    return <ErrorState message={errorMessage} onRetry={onRetry} />;
  }

  const conversations = data ?? [];

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={<MessageCircle size={40} color={colors.inkFaint} />}
        title="No messages yet"
        body="Message a seller from a listing to start a conversation."
      />
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => onPress(item.id)} />}
      ItemSeparatorComponent={Divider}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    />
  );
}

function RequestsList({
  data,
  isPending,
  isError,
  errorMessage,
  onRetry,
  viewerId,
  refreshing,
  onRefresh,
  onPress,
}: {
  data: ReservationDetail[] | undefined;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  viewerId: string;
  refreshing: boolean;
  onRefresh: () => void;
  onPress: (id: string) => void;
}) {
  if (isPending) {
    return (
      <View style={styles.listContent}>
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </View>
    );
  }

  if (isError) {
    return <ErrorState message={errorMessage} onRetry={onRetry} />;
  }

  const reservations = data ?? [];

  if (reservations.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <EmptyState
          icon={<InboxIcon size={40} color={colors.inkFaint} />}
          title="No requests yet"
          body="When you request a meetup, or someone requests one on your listing, it shows up here."
        />
      </ScrollView>
    );
  }

  const asBuyer = reservations.filter((r) => r.buyerId === viewerId);
  const asSeller = reservations.filter((r) => r.sellerId === viewerId);

  return (
    <ScrollView
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {asSeller.length > 0 ? (
        <ReservationGroup title="As seller" reservations={asSeller} viewerId={viewerId} role="seller" onPress={onPress} />
      ) : null}
      {asBuyer.length > 0 ? (
        <ReservationGroup title="As buyer" reservations={asBuyer} viewerId={viewerId} role="buyer" onPress={onPress} />
      ) : null}
    </ScrollView>
  );
}

function ReservationGroup({
  title,
  reservations,
  viewerId,
  role,
  onPress,
}: {
  title: string;
  reservations: ReservationDetail[];
  viewerId: string;
  role: 'buyer' | 'seller';
  onPress: (id: string) => void;
}) {
  return (
    <View style={styles.group}>
      <Text variant="label" color="inkMuted" style={styles.groupTitle}>
        {title.toUpperCase()}
      </Text>
      {reservations.map((r, i) => (
        <View key={r.id}>
          <ReservationRow reservation={r} viewerId={viewerId} role={role} onPress={() => onPress(r.id)} />
          {i < reservations.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </View>
  );
}

function RowSkeleton() {
  return (
    <View style={styles.rowSkeleton}>
      <Skeleton width={52} height={52} radius={10} />
      <View style={styles.rowSkeletonInfo}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { gap: space.md, paddingTop: space.lg },
  header: { paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  tabsWrap: { paddingHorizontal: space.lg, marginBottom: space.sm },
  listContent: { paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  rowSkeleton: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowSkeletonInfo: { flex: 1, gap: space.sm, justifyContent: 'center' },
  group: { marginBottom: space.xl },
  groupTitle: { marginBottom: space.xs, marginTop: space.md },
});
