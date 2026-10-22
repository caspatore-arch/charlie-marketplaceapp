/**
 * "Meetups & messages" stack screen (moved off the tab bar): Meetups
 * (reservation.mine; needs-reply and upcoming first by start time, finished
 * ones collapsed under "Earlier"), Messages (conversation.list) and, only when
 * OFFERS_ENABLED, Offers (offer.mine, with Accept/Decline for a seller's
 * pending offers). Requires auth; polls every 10s while focused as a
 * stand-in for push notifications.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, useIsFocused, Stack } from 'expo-router';
import { ChevronDown, ChevronUp, MessageCircle, Inbox as InboxIcon, Tag } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Divider } from '@/components/ui/Divider';
import { SegmentedTabs } from '@/components/inbox/SegmentedTabs';
import { OfferRow } from '@/components/inbox/OfferRow';
import { ConversationRow } from '@/components/inbox/ConversationRow';
import { ReservationRow } from '@/components/inbox/ReservationRow';
import { OFFERS_ENABLED } from '@/constants/features';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { colors, space } from '@/constants/theme';
import type { ConversationSummary, OfferWithContext, ReservationDetail } from '@/types';

const POLL_MS = 10_000;

type Tab = 'meetups' | 'offers' | 'messages';

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
          title="Sign in to see your meetups and messages"
          body="Your meetups and messages with buyers and sellers show up here."
          actionLabel="Sign in"
          onAction={() => router.push('/auth/sign-in')}
        />
      </Screen>
    );
  }

  return <SignedInInbox />;
}

function SignedInInbox() {
  const [tab, setTab] = useState<Tab>('meetups');
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

  const offersQuery = trpc.offer.mine.useQuery(undefined, {
    refetchInterval: isFocused ? POLL_MS : false,
    enabled: OFFERS_ENABLED,
  });
  const utils = trpc.useUtils();
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const afterOfferChange = () => {
    void utils.offer.mine.invalidate();
    void utils.listing.byId.invalidate();
  };
  const acceptMutation = trpc.offer.accept.useMutation({
    onSuccess: afterOfferChange,
    onError: (e) => setOfferError(e.message),
    onSettled: () => setBusyOfferId(null),
  });
  const declineMutation = trpc.offer.decline.useMutation({
    onSuccess: afterOfferChange,
    onError: (e) => setOfferError(e.message),
    onSettled: () => setBusyOfferId(null),
  });
  const onAccept = (o: OfferWithContext) =>
    confirmAction(
      'Accept this offer?',
      `${o.buyer.displayName} would get first chance to book this item for an hour.`,
      'Accept',
      () => {
        setOfferError(null);
        setBusyOfferId(o.id);
        acceptMutation.mutate({ id: o.id });
      },
      { destructive: false },
    );
  const onDecline = (o: OfferWithContext) =>
    confirmAction(
      'Decline this offer?',
      `${o.buyer.displayName} will be told it was declined.`,
      'Decline',
      () => {
        setOfferError(null);
        setBusyOfferId(o.id);
        declineMutation.mutate({ id: o.id });
      },
    );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        conversationsQuery.refetch(),
        reservationsQuery.refetch(),
        ...(OFFERS_ENABLED ? [offersQuery.refetch()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [conversationsQuery, reservationsQuery, offersQuery]);

  const unreadCount = useMemo(
    () => (conversationsQuery.data ?? []).reduce((sum, c) => sum + (c.unreadCount > 0 ? 1 : 0), 0),
    [conversationsQuery.data],
  );
  const needsReplyCount = useMemo(() => {
    if (!user) return 0;
    return (reservationsQuery.data ?? []).filter((r) => needsReply(r, user.id)).length;
  }, [reservationsQuery.data, user]);

  const pendingOffersToAnswer = useMemo(
    () => (offersQuery.data ?? []).filter((o) => o.sellerId === user?.id && o.status === 'pending').length,
    [offersQuery.data, user],
  );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Meetups & messages' }} />
      <View style={styles.tabsWrap}>
        <SegmentedTabs
          segments={[
            { key: 'meetups', label: 'Meetups', badge: needsReplyCount || undefined, badgeLabel: 'need your reply' },
            ...(OFFERS_ENABLED
              ? [{ key: 'offers' as const, label: 'Offers', badge: pendingOffersToAnswer || undefined, badgeLabel: 'to answer' }]
              : []),
            { key: 'messages', label: 'Messages', badge: unreadCount || undefined, badgeLabel: 'unread' },
          ]}
          value={tab}
          onChange={(next) => {
            setOfferError(null);
            setTab(next);
          }}
        />
      </View>

      {OFFERS_ENABLED && tab === 'offers' ? (
        <OffersList
          data={offersQuery.data}
          isPending={offersQuery.isPending}
          isError={offersQuery.isError}
          errorMessage={offersQuery.error?.message}
          onRetry={() => offersQuery.refetch()}
          viewerId={user?.id ?? ''}
          refreshing={refreshing}
          onRefresh={onRefresh}
          busyId={busyOfferId}
          actionError={offerError}
          onOpen={(o) => router.push(`/listing/${o.listingId}`)}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      ) : tab === 'messages' ? (
        <MessagesList
          data={conversationsQuery.data}
          isPending={conversationsQuery.isPending}
          isError={conversationsQuery.isError}
          errorMessage={conversationsQuery.error?.message}
          onRetry={() => conversationsQuery.refetch()}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onPress={(id) => router.push(`/conversation/${id}`)}
          onBrowse={() => router.replace('/')}
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
          onBrowse={() => router.replace('/')}
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
  onBrowse,
}: {
  data: ConversationSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  onPress: (id: string) => void;
  onBrowse: () => void;
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
        actionLabel="Browse listings"
        onAction={onBrowse}
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

function OffersList({
  data,
  isPending,
  isError,
  errorMessage,
  onRetry,
  viewerId,
  refreshing,
  onRefresh,
  busyId,
  actionError,
  onOpen,
  onAccept,
  onDecline,
}: {
  data: OfferWithContext[] | undefined;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  viewerId: string;
  refreshing: boolean;
  onRefresh: () => void;
  busyId: string | null;
  actionError: string | null;
  onOpen: (o: OfferWithContext) => void;
  onAccept: (o: OfferWithContext) => void;
  onDecline: (o: OfferWithContext) => void;
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
  const offers = data ?? [];
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />;

  if (offers.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.listContent} refreshControl={refresh}>
        <EmptyState
          icon={<Tag size={40} color={colors.inkFaint} />}
          title="No offers yet"
          body="Offers you make, and offers on your items, show up here."
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.listContent} refreshControl={refresh}>
      {actionError ? (
        <Text variant="label" color="danger" style={styles.actionError} accessibilityRole="alert">
          {actionError}
        </Text>
      ) : null}
      {offers.map((o, i) => (
        <View key={o.id}>
          <OfferRow
            offer={o}
            viewerId={viewerId}
            busy={busyId === o.id}
            onPress={() => onOpen(o)}
            onAccept={() => onAccept(o)}
            onDecline={() => onDecline(o)}
          />
          {i < offers.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </ScrollView>
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
  onBrowse,
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
  onBrowse: () => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
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
          title="No meetups yet"
          body="When you book a meetup, or someone books one on your listing, it shows up here."
          actionLabel="Browse listings"
          onAction={onBrowse}
        />
      </ScrollView>
    );
  }

  const isEarlier = (r: ReservationDetail) =>
    r.status === 'completed' || r.status === 'cancelled' || r.status === 'declined' || r.status === 'expired';
  const byStart = (a: ReservationDetail, b: ReservationDetail) => a.startsAt.getTime() - b.startsAt.getTime();
  const needsYou = reservations.filter((r) => !isEarlier(r) && needsReply(r, viewerId)).sort(byStart);
  const upcoming = reservations.filter((r) => !isEarlier(r) && !needsReply(r, viewerId)).sort(byStart);
  const earlier = reservations.filter(isEarlier).sort((a, b) => byStart(b, a));
  const roleOf = (r: ReservationDetail): 'buyer' | 'seller' => (r.sellerId === viewerId ? 'seller' : 'buyer');

  return (
    <ScrollView
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {needsYou.length > 0 ? (
        <ReservationGroup title="Needs your reply" reservations={needsYou} viewerId={viewerId} roleOf={roleOf} onPress={onPress} />
      ) : null}
      {upcoming.length > 0 ? (
        <ReservationGroup title="Upcoming" reservations={upcoming} viewerId={viewerId} roleOf={roleOf} onPress={onPress} />
      ) : null}
      {needsYou.length === 0 && upcoming.length === 0 ? (
        <Text variant="body" color="inkMuted" style={styles.noUpcoming}>
          Nothing upcoming. Browse listings to book a meetup.
        </Text>
      ) : null}
      {earlier.length > 0 ? (
        <View style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showEarlier }}
            accessibilityLabel={`Earlier, ${earlier.length} past meetups. ${showEarlier ? 'Hide' : 'Show'}.`}
            onPress={() => setShowEarlier((v) => !v)}
            style={styles.earlierToggle}
          >
            <Text variant="label" color="inkMuted" style={styles.earlierText}>
              EARLIER ({earlier.length})
            </Text>
            {showEarlier ? <ChevronUp size={18} color={colors.inkMuted} /> : <ChevronDown size={18} color={colors.inkMuted} />}
          </Pressable>
          {showEarlier ? (
            <ReservationGroup reservations={earlier} viewerId={viewerId} roleOf={roleOf} onPress={onPress} />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function needsReply(r: ReservationDetail, viewerId: string): boolean {
  return (r.status === 'requested' || r.status === 'countered') && r.proposedById !== viewerId;
}

function ReservationGroup({
  title,
  reservations,
  viewerId,
  roleOf,
  onPress,
}: {
  title?: string;
  reservations: ReservationDetail[];
  viewerId: string;
  roleOf: (r: ReservationDetail) => 'buyer' | 'seller';
  onPress: (id: string) => void;
}) {
  return (
    <View style={styles.group}>
      {title ? (
        <Text variant="label" color="inkMuted" style={styles.groupTitle}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {reservations.map((r, i) => (
        <View key={r.id}>
          <ReservationRow reservation={r} viewerId={viewerId} role={roleOf(r)} onPress={() => onPress(r.id)} />
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
  actionError: { marginBottom: space.sm },
  tabsWrap: { paddingHorizontal: space.lg, marginTop: space.sm, marginBottom: space.sm },
  listContent: { paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  rowSkeleton: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowSkeletonInfo: { flex: 1, gap: space.sm, justifyContent: 'center' },
  group: { marginBottom: space.xl },
  groupTitle: { marginBottom: space.xs, marginTop: space.md },
  noUpcoming: { marginTop: space.lg, marginBottom: space.lg },
  earlierToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  earlierText: { flex: 1 },
});
