/**
 * Community tab: short campus posts ("Does anyone have shirts?") that stay up until
 * removed, plus an automatic post for every listing (kept while it is live or archived).
 * Posts show the author's normal display name. Buyers / Sellers tabs, Top /
 * Newest / Hottest sorts (all ranked by the server), upvotes, composer,
 * pull-to-refresh, infinite scroll, per-post actions (delete / report / block).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MessagesSquare, Users } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { FeedPost } from '@/components/community/FeedPost';
import { ListingPost } from '@/components/community/ListingPost';
import { FeedControls, type CommunitySort } from '@/components/community/FeedControls';
import { PostComposer } from '@/components/community/PostComposer';
import { PostReportSheet } from '@/components/community/PostReportSheet';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { colors, space } from '@/constants/theme';
import type { CommunityPost, CommunityPostKind } from '@/types';

const SHOW_LISTINGS_KEY = 'dibbs.community.showListings';

export default function CommunityScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const requireAuth = useRequireAuth();

  if (status === 'loading') {
    return (
      <Screen>
        <View style={styles.skeletons}>
          <Skeleton height={32} width={160} />
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      </Screen>
    );
  }

  if (status === 'signedOut') {
    return (
      <Screen>
        <EmptyState
          icon={<Users size={40} color={colors.inkFaint} />}
          title="Sign in to join your campus community"
          body="Ask if anyone's selling what you need, or let people know what you have."
          actionLabel="Sign in"
          onAction={() => requireAuth('/community')}
        />
      </Screen>
    );
  }

  return <SignedInCommunity onOpenInbox={() => router.push('/inbox')} />;
}

function SignedInCommunity({ onOpenInbox }: { onOpenInbox: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  // Every new listing is posted here automatically as a 'selling' post, so the
  // feed opens on Sellers where they are; Buyers is one tap away.
  const [kind, setKind] = useState<CommunityPostKind>('selling');
  const [sort, setSort] = useState<CommunitySort>('new');
  // Per-device preference: listing posts are shown unless the viewer turned them off.
  const [showListings, setShowListingsState] = useState(true);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SHOW_LISTINGS_KEY)
      .then((v) => { if (active && v === 'off') setShowListingsState(false); })
      .catch(() => { /* default on */ });
    return () => { active = false; };
  }, []);
  const setShowListings = useCallback((show: boolean) => {
    setShowListingsState(show);
    try {
      AsyncStorage.setItem(SHOW_LISTINGS_KEY, show ? 'on' : 'off').catch(() => { /* preference just won't persist */ });
    } catch { /* ignore */ }
  }, []);
  const [actionPost, setActionPost] = useState<CommunityPost | null>(null);
  const [reportPost, setReportPost] = useState<CommunityPost | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const me = trpc.auth.me.useQuery();
  const unread = trpc.conversation.unreadTotal.useQuery(undefined, { refetchInterval: 15_000 });
  const inboxBadge = (unread.data?.conversations ?? 0) + (unread.data?.actionableReservations ?? 0);
  const feed = trpc.community.feed.useInfiniteQuery(
    { kind, sort, includeListings: showListings, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const posts = useMemo(() => {
    const seen = new Set<string>();
    const out: CommunityPost[] = [];
    for (const page of feed.data?.pages ?? []) {
      for (const p of page.items) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }, [feed.data]);

  const refetchFeed = useCallback(() => utils.community.feed.invalidate(), [utils]);

  const remove = trpc.community.remove.useMutation({
    onSuccess: refetchFeed,
    onError: (e) => setActionError(e.message),
  });
  const report = trpc.community.report.useMutation({
    onSuccess: () => {
      setReportPost(null);
      setNotice("Thanks. We'll review the post.");
    },
  });
  const block = trpc.user.block.useMutation({
    onSuccess: () => {
      setNotice('User blocked. You will no longer see their posts.');
      void refetchFeed();
      void utils.user.blocked.invalidate();
    },
    onError: (e) => setActionError(e.message),
  });

  const closeActions = () => setActionPost(null);

  const header = (
    <View style={styles.listHeader}>
      <PostComposer
        kind={kind}
        onKind={setKind}
        onPosted={(posted) => {
          setKind(posted);
          void refetchFeed();
        }}
        postingStatus={me.data?.postingStatus}
      />
      <FeedControls kind={kind} sort={sort} onKind={setKind} onSort={setSort} showListings={showListings} onShowListings={setShowListings} />
      {notice ? (
        <Text variant="label" color="success" accessibilityRole="alert">
          {notice}
        </Text>
      ) : null}
      {actionError ? (
        <Text variant="label" color="danger" accessibilityRole="alert">
          {actionError}
        </Text>
      ) : null}
    </View>
  );

  let empty: React.ReactNode = null;
  if (feed.isPending) {
    empty = (
      <View style={styles.skeletons}>
        <Skeleton height={110} />
        <Skeleton height={110} />
        <Skeleton height={110} />
      </View>
    );
  } else if (feed.isError) {
    empty = <ErrorState message={feed.error.message} onRetry={() => feed.refetch()} />;
  } else if (!showListings) {
    empty = (
      <EmptyState
        icon={<Users size={40} color={colors.inkFaint} />}
        title="No posts yet"
        body="Turn listings back on to see items for sale."
      />
    );
  } else {
    empty = (
      <EmptyState
        icon={<Users size={40} color={colors.inkFaint} />}
        title={kind === 'buying' ? 'No buyer posts yet' : 'No seller posts yet'}
        body={
          kind === 'buying'
            ? 'Nobody is looking for anything right now. Posts stay up until their author deletes them.'
            : "Nobody is selling anything here right now. Posts stay up until their author deletes them."
        }
      />
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text variant="title">Community</Text>
          {me.data?.campus?.name ? (
            <Text variant="label" color="inkMuted">
              {me.data.campus.name}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={inboxBadge > 0 ? `Meetups and messages, ${inboxBadge} need attention` : 'Meetups and messages'}
          onPress={onOpenInbox}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <MessagesSquare size={24} color={colors.ink} />
          {inboxBadge > 0 ? (
            <View style={styles.badge}>
              <Text variant="caption" weight="600" color="white">
                {inboxBadge > 9 ? '9+' : inboxBadge}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }) => {
          const props = {
            post: item,
            onPressAuthor: () => router.push(`/user/${item.author.id}`),
            onOpenActions: () => {
              setActionError(null);
              setNotice(null);
              setActionPost(item);
            },
          };
          // A listing post is the listing's own thread and likes (see ListingPost).
          return item.listing && item.engagement ? (
            <ListingPost {...props} listing={item.listing} engagement={item.engagement} />
          ) : (
            <FeedPost {...props} />
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => feed.refetch()}
            tintColor={colors.accent}
          />
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={feed.isFetchingNextPage ? <Skeleton height={80} style={styles.footerSkeleton} /> : null}
      />

      <Sheet visible={!!actionPost} onClose={closeActions} title="Post actions">
        {actionPost?.isMine ? (
          <Button
            title="Delete post"
            variant="danger"
            onPress={() => {
              const post = actionPost;
              closeActions();
              confirmAction('Delete this post?', 'It will disappear from the community feed.', 'Delete', () =>
                remove.mutate({ id: post.id }),
              );
            }}
          />
        ) : actionPost ? (
          <View style={styles.actions}>
            <Button
              title="Report post"
              variant="secondary"
              onPress={() => {
                setReportPost(actionPost);
                closeActions();
              }}
            />
            <Button
              title={`Block ${actionPost.author.displayName}`}
              variant="danger"
              onPress={() => {
                const post = actionPost;
                closeActions();
                confirmAction(
                  `Block ${post.author.displayName}?`,
                  "You won't see each other's posts, and they can't message you.",
                  'Block',
                  () => block.mutate({ userId: post.author.id }),
                );
              }}
            />
          </View>
        ) : null}
      </Sheet>

      <PostReportSheet
        key={reportPost?.id ?? 'none'}
        visible={!!reportPost}
        onClose={() => setReportPost(null)}
        loading={report.isPending}
        error={report.error?.message}
        onSubmit={(reason, details) => reportPost && report.mutate({ id: reportPost.id, reason, details })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: space.md, padding: space.lg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  titleText: { flex: 1 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  badge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, flexGrow: 1 },
  listHeader: { gap: space.md, paddingBottom: space.md },
  actions: { gap: space.sm },
  footerSkeleton: { marginTop: space.md },
});
