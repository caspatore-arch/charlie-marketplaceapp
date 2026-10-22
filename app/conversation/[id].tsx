/**
 * Conversation screen: header (other user's name, "…" menu with Report and
 * Block), a listing bar (thumbnail, price, tap → listing), an optional
 * reservation summary strip when one exists between these two people for this
 * listing, an inverted message list with day separators, and a growing
 * composer. A failed send stays in the thread as "Not sent · Retry". Polls
 * every 5s while focused; loads older pages via cursor. `conversation.list`
 * doubles as this screen's "byId" lookup since the router has no dedicated
 * single-conversation query.
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
import { ChevronRight, MoreHorizontal, Send } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ReportSheet } from '@/components/browse/ReportSheet';
import { confirmAction } from '@/utils/confirm';
import { MessageBubble } from '@/components/MessageBubble';
import { ReservationStatusPill } from '@/components/ReservationStatusPill';
import { trpc, resolveMediaUrl } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import { formatMeetupTime, formatPrice } from '@/utils/format';
import type { Message, ReportReason } from '@/types';

const POLL_MS = 5_000;
const MAX_COMPOSER_HEIGHT = 100;
const MIN_COMPOSER_HEIGHT = 44;

interface OptimisticMessage extends Message {
  pending?: boolean;
  failed?: boolean;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Real distance from the top of the window to this screen's content (the
  // header's height), measured on layout, used as the keyboard offset.
  const contentRef = React.useRef<View>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const measureHeader = useCallback(() => {
    contentRef.current?.measureInWindow((_x, y) => setHeaderHeight(Math.max(0, y)));
  }, []);
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);
  const reportMutation = trpc.user.report.useMutation({
    onSuccess: () => {
      setReportOpen(false);
      setSafetyNotice("Thanks. We'll review this.");
    },
    onError: (e) => setSafetyNotice(`Couldn't send the report: ${e.message}`),
  });
  const blockMutation = trpc.user.block.useMutation({
    onSuccess: () => {
      void utils.conversation.list.invalidate();
      void utils.user.blocked.invalidate();
      router.back();
    },
    onError: (e) => setSafetyNotice(`Couldn't block: ${e.message}`),
  });
  const submitReport = (reason: ReportReason, details?: string) => {
    if (!otherUserId) return;
    reportMutation.mutate({ targetUserId: otherUserId, reason, details });
  };
  const confirmBlock = () => {
    if (!convo) return;
    setMenuOpen(false);
    confirmAction(
      `Block ${convo.otherUser.displayName}?`,
      'They will no longer be able to message or request meetups with you.',
      'Block',
      () => blockMutation.mutate({ userId: convo.otherUser.id }),
    );
  };

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
    return merged
      .slice()
      .sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
  }, [messagesQuery.data, optimistic]);

  // Mark read when the thread opens and when a message from the other person
  // arrives while focused. Our own sends don't need a mark-read round trip.
  const latestMessage = allMessages[0];
  const latestMessageId = latestMessage?.id;
  const latestIsOwn = !!latestMessage && latestMessage.senderId === user?.id;
  const markedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!id || !isFocused) return;
    if (!latestMessageId) return; // nothing to mark read yet (or still loading)
    if (latestIsOwn && markedRef.current) return;
    markedRef.current = latestMessageId;
    markReadMutation.mutate({ conversationId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isFocused, latestMessageId]);

  const sendBody = useCallback(
    (tempId: string, body: string) => {
      sendMutation.mutate(
        { conversationId: id, body },
        {
          onSuccess: () => {
            setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
          },
          onError: () => {
            setOptimistic((prev) =>
              prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
            );
          },
        },
      );
    },
    [id, sendMutation],
  );

  const onRetry = useCallback(
    (tempId: string) => {
      const target = optimistic.find((m) => m.id === tempId);
      if (!target) return;
      setOptimistic((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pending: true, failed: false } : m)),
      );
      sendBody(tempId, target.body);
    },
    [optimistic, sendBody],
  );

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
    sendBody(tempId, body);
  }, [draft, id, sendBody, user]);

  const onContentSizeChange = useCallback((e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    const next = Math.min(
      MAX_COMPOSER_HEIGHT,
      Math.max(MIN_COMPOSER_HEIGHT, e.nativeEvent.contentSize.height),
    );
    setComposerHeight(next);
  }, []);

  const isForbidden =
    messagesQuery.isError &&
    (messagesQuery.error as { data?: { code?: string } })?.data?.code === 'FORBIDDEN';

  return (
    <Screen edges={['left', 'right']} padded={false}>
      <Stack.Screen
        options={{
          title: convo?.otherUser.displayName ?? 'Conversation',
          headerRight: convo
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="More options: report or block"
                  onPress={() => setMenuOpen(true)}
                  hitSlop={8}
                  style={styles.menuButton}
                >
                  <MoreHorizontal size={22} color={colors.ink} />
                </Pressable>
              )
            : undefined,
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
              {convo.listing.title} · {formatPrice(convo.listing.currentPriceCents)}
            </Text>
          </View>
          {convo.listing.seller.isDemo ? <Badge kind="demo" /> : null}
          <ChevronRight size={18} color={colors.inkFaint} />
        </Pressable>
      ) : null}

      {relatedReservation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Meetup ${relatedReservation.status}, ${relatedReservation.spot?.name ?? 'custom address'}`}
          onPress={() => router.push(`/reservation/${relatedReservation.id}`)}
          style={styles.reservationStrip}
        >
          <ReservationStatusPill status={relatedReservation.status} />
          <View style={styles.reservationInfo}>
            <Text variant="caption" weight="600" numberOfLines={1}>
              {relatedReservation.spot?.name ?? 'Custom address'}
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
        <View ref={contentRef} onLayout={measureHeader} style={styles.flex}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
          >
            {safetyNotice ? (
              <Text variant="label" color="inkMuted" style={styles.notice} accessibilityRole="alert">
                {safetyNotice}
              </Text>
            ) : null}
            <MessageList
              messages={allMessages}
              onRetry={onRetry}
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
        </View>
      )}

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Conversation options">
        <View style={styles.menuActions}>
          <Button
            title={`Report ${convo?.otherUser.displayName ?? 'this person'}`}
            variant="secondary"
            onPress={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
          <Button
            title={`Block ${convo?.otherUser.displayName ?? 'this person'}`}
            variant="danger"
            onPress={confirmBlock}
          />
        </View>
      </Sheet>
      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
        loading={reportMutation.isPending}
        title="Report this person"
      />
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
  onRetry,
}: {
  onRetry: (tempId: string) => void;
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
        <Text variant="label" color="inkMuted" style={styles.safetyNote}>
          Meet at the public campus spots. Don&apos;t share personal info you don&apos;t need to.
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
            {showDaySeparator ? <DaySeparator date={item.createdAt} /> : null}
            <MessageBubble
              body={item.body}
              createdAt={item.createdAt.toISOString()}
              isOwn={item.senderId === viewerId}
            />
            {item.failed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Message not sent. Retry."
                onPress={() => onRetry(item.id)}
                style={styles.failed}
              >
                <Text variant="caption" weight="600" color="danger">
                  Not sent · Retry
                </Text>
              </Pressable>
            ) : null}
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
  const label = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
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
  listingThumb: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  listingInfo: { flex: 1, gap: 2 },
  listingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
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
  messagesContent: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.xs,
  },
  daySeparator: { alignItems: 'center', marginVertical: space.md },
  loadingMore: { marginVertical: space.md, marginHorizontal: space.lg },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  emptyText: { textAlign: 'center' },
  safetyNote: { textAlign: 'center', marginTop: space.lg, maxWidth: 320 },
  failed: {
    alignSelf: 'flex-end',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  notice: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  menuButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuActions: { gap: space.sm },
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
