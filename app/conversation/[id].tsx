/**
 * Conversation screen: header (other user + listing title, tap → listing),
 * an optional reservation summary strip when one exists between these two
 * people for this listing, an inverted message list with day separators, and
 * a growing composer. Polls every 5s while focused; loads older pages via
 * cursor. `conversation.list` doubles as this screen's "byId" lookup since
 * the router has no dedicated single-conversation query.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, useIsFocused, Stack } from 'expo-router';
import { Send } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { MessageBubble } from '@/components/MessageBubble';
import { ReservationStatusPill } from '@/components/ReservationStatusPill';
import { trpc, resolveMediaUrl } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import { formatMeetupTime } from '@/utils/format';
import type { Message } from '@/types';

const POLL_MS = 5_000;
const MAX_COMPOSER_HEIGHT = 100;
const MIN_COMPOSER_HEIGHT = 44;

interface OptimisticMessage extends Message {
  pending?: boolean;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const conversationsQuery = trpc.conversation.list.useQuery(undefined, {
    refetchInterval: isFocused ? POLL_MS : false,
  });
  const convo = useMemo(
    () => conversationsQuery.data?.find((c) => c.id === id),
    [conversationsQuery.data, id],
  );

  const messagesQuery = trpc.conversation.messages.useInfiniteQuery(
    { conversationId: id },
    {
      enabled: !!id,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: isFocused ? POLL_MS : false,
    },
  );

  const isSeller = !!(convo && user && convo.listing.seller.id === user.id);
  const otherUserId = convo?.otherUser.id;
  const buyerId = convo ? (isSeller ? otherUserId : user?.id) : undefined;
  const sellerId = convo ? (isSeller ? user?.id : otherUserId) : undefined;

  const reservationsQuery = trpc.reservation.mine.useQuery(
    {},
    { enabled: !!convo, refetchInterval: isFocused ? POLL_MS : false },
  );
  const relatedReservation = useMemo(() => {
    if (!convo || !reservationsQuery.data) return undefined;
    return reservationsQuery.data.find(
      (r) => r.listingId === convo.listing.id && r.buyerId === buyerId && r.sellerId === sellerId,
    );
  }, [convo, reservationsQuery.data, buyerId, sellerId]);

  const [draft, setDraft] = useState('');
  const [composerHeight, setComposerHeight] = useState(MIN_COMPOSER_HEIGHT);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);

  const sendMutation = trpc.conversation.send.useMutation({
    onSuccess: () => {
      utils.conversation.messages.invalidate({ conversationId: id });
      utils.conversation.list.invalidate();
    },
  });

  const markReadMutation = trpc.conversation.markRead.useMutation({
    onSuccess: () => {
      utils.conversation.list.invalidate();
      utils.conversation.unreadTotal.invalidate();
    },
  });

  const allMessages = useMemo<OptimisticMessage[]>(() => {
    const fetched = (messagesQuery.data?.pages ?? []).flatMap((p) => p.items);
    const merged = [...fetched, ...optimistic.filter((o) => !fetched.some((f) => f.id === o.id))];
    return merged.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [messagesQuery.data, optimistic]);

  // Mark read when the thread opens and whenever new messages arrive while focused.
  const latestMessageId = allMessages[0]?.id;
  React.useEffect(() => {
    if (!id || !isFocused) return;
    if (!latestMessageId) return; // nothing to mark read yet (or still loading)
    markReadMutation.mutate({ conversationId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isFocused, latestMessageId]);

  const handleSend = useCallback(() => {
    const body = draft.trim();
    if (!body || !user) return;
    const tempId = `temp-${Date.now()}`;
    setOptimistic((prev) => [
      ...prev,
      {
        id: tempId,
        conversationId: id,
        senderId: user.id,
        body,
        createdAt: new Date(),
        pending: true,
      },
    ]);
    setDraft('');
    setComposerHeight(MIN_COMPOSER_HEIGHT);
    sendMutation.mutate(
      { conversationId: id, body },
      {
        onSuccess: () => {
          setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        },
        onError: () => {
          setOptimistic((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false } : m)));
        },
      },
    );
  }, [draft, id, sendMutation, user],
  );

  const onContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const next = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, e.nativeEvent.contentSize.height));
      setComposerHeight(next);
    },
    [],
  );

  const isForbidden = messagesQuery.isError && (messagesQuery.error as { data?: { code?: string } })?.data?.code === 'FORBIDDEN';

  return (
    <Screen edges={['left', 'right']} padded={false}>
      <Stack.Screen
        options={{
          title: convo?.otherUser.displayName ?? 'Conversation',
        }}
      />

      {convo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View listing ${convo.listing.title}`}
          onPress={() => router.push(`/listing/${convo.listing.id}`)}
          style={styles.listingBar}
        >
          <Image
            source={{ uri: resolveMediaUrl(convo.listing.coverPhotoUrl) }}
            style={styles.listingThumb}
            contentFit="cover"
          />
          <View style={styles.listingInfo}>
            <View style={styles.listingHeaderRow}>
              <Avatar uri={convo.otherUser.avatarUrl} name={convo.otherUser.displayName} size={20} />
              <Text variant="label" weight="600" numberOfLines={1} style={styles.listingOther}>
                {convo.otherUser.displayName}
              </Text>
            </View>
            <Text variant="caption" color="inkMuted" numberOfLines={1}>
              {convo.listing.title}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {relatedReservation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Meetup ${relatedReservation.status}, ${relatedReservation.spot.name}`}
          onPress={() => router.push(`/reservation/${relatedReservation.id}`)}
          style={styles.reservationStrip}
        >
          <ReservationStatusPill status={relatedReservation.status} />
          <View style={styles.reservationInfo}>
            <Text variant="caption" weight="600" numberOfLines={1}>
              {relatedReservation.spot.name}
            </Text>
            <Text variant="caption" color="inkMuted" numberOfLines={1}>
              {formatMeetupTime(relatedReservation.startsAt.toISOString())}
            </Text>
          </View>
          <Text variant="caption" color="accent" weight="600">
            View
          </Text>
        </Pressable>
      ) : null}

      {isForbidden ? (
        <ErrorState message="You don't have access to this conversation." />
      ) : messagesQuery.isPending ? (
        <View style={styles.loadingWrap}>
          <Skeleton height={40} />
          <Skeleton height={40} width="70%" />
          <Skeleton height={40} width="60%" />
        </View>
      ) : messagesQuery.isError ? (
        <ErrorState message={messagesQuery.error.message} onRetry={() => messagesQuery.refetch()} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
        >
          <MessageList
            messages={allMessages}
            viewerId={user?.id ?? ''}
            hasMore={!!messagesQuery.hasNextPage}
            onLoadMore={() => messagesQuery.fetchNextPage()}
            loadingMore={messagesQuery.isFetchingNextPage}
          />

          <View style={[styles.composer, { minHeight: composerHeight + space.lg }]}>
            <ComposerInput
              value={draft}
              onChangeText={setDraft}
              onContentSizeChange={onContentSizeChange}
              height={composerHeight}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !draft.trim() }}
              disabled={!draft.trim() || sendMutation.isPending}
              onPress={handleSend}
              style={({ pressed }) => [
                styles.sendButton,
                (!draft.trim() || sendMutation.isPending) && styles.sendButtonDisabled,
                pressed && styles.sendButtonPressed,
              ]}
            >
              <Send size={20} color={colors.white} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function ComposerInput({
  value,
  onChangeText,
  onContentSizeChange,
  height,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onContentSizeChange: (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => void;
  height: number;
}) {
  // Kept local (not components/ui/Input) since it needs custom auto-grow
  // sizing tied to the composer bar, not the standard labeled field.
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onContentSizeChange={onContentSizeChange}
      placeholder="Message..."
      placeholderTextColor={colors.inkFaint}
      multiline
      allowFontScaling
      accessibilityLabel="Message input"
      style={[styles.input, { height }]}
    />
  );
}

function MessageList({
  messages,
  viewerId,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  messages: OptimisticMessage[];
  viewerId: string;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  if (messages.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text variant="body" color="inkMuted" style={styles.emptyText}>
          No messages yet. Say hello.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={messages}
      inverted
      keyExtractor={(m) => m.id}
      contentContainerStyle={styles.messagesContent}
      renderItem={({ item, index }) => {
        const next = messages[index + 1]; // older message (since inverted)
        const showDaySeparator = !next || !isSameDay(item.createdAt, next.createdAt);
        return (
          <View>
            <MessageBubble body={item.body} createdAt={item.createdAt.toISOString()} isOwn={item.senderId === viewerId} />
            {showDaySeparator ? <DaySeparator date={item.createdAt} /> : null}
          </View>
        );
      }}
      onEndReached={() => {
        if (hasMore && !loadingMore) onLoadMore();
      }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={loadingMore ? <Skeleton height={32} style={styles.loadingMore} /> : null}
    />
  );
}

function DaySeparator({ date }: { date: Date }) {
  const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
  return (
    <View style={styles.daySeparator}>
      <Text variant="caption" color="inkFaint" weight="600">
        {label}
      </Text>
    </View>
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingWrap: { gap: space.md, padding: space.lg },
  listingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  listingThumb: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  listingInfo: { flex: 1, gap: 2 },
  listingHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  listingOther: { flexShrink: 1 },
  reservationStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  reservationInfo: { flex: 1 },
  messagesContent: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  daySeparator: { alignItems: 'center', marginVertical: space.md },
  loadingMore: { marginVertical: space.md, marginHorizontal: space.lg },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  emptyText: { textAlign: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: MIN_COMPOSER_HEIGHT,
    maxHeight: MAX_COMPOSER_HEIGHT,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  sendButton: {
    width: minTouchHeight,
    height: minTouchHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonPressed: { opacity: 0.85 },
});
