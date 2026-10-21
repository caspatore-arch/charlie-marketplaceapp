/**
 * Listings / Posts / Comments tabs, identical on your profile and anyone else's.
 *
 * Deliberately no conversations here. Chats are private between two people:
 * nothing in this component, or in the queries behind it, takes a
 * conversation id or lists who someone talks to. Your own chats stay one tap
 * away on your own profile (InboxLinkRow), scoped to you on the server.
 */
import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ListingCard } from '@/components/ListingCard';
import { SegmentedTabs } from '@/components/inbox/SegmentedTabs';
import { trpc } from '@/lib/trpc';
import { timeLeftLabel, useNow } from '@/components/community/useNow';
import { formatRelative } from '@/utils/format';
import { space } from '@/constants/theme';

type Tab = 'listings' | 'posts' | 'comments';

export function ProfileContent({
  userId,
  isSelf,
  firstName,
}: {
  userId: string;
  isSelf: boolean;
  firstName: string;
}) {
  const [tab, setTab] = useState<Tab>('listings');
  const router = useRouter();
  const now = useNow();

  // Own profile reuses listing.mine (and filters to what is on offer);
  // someone else's reuses listing.bySeller.
  const mine = trpc.listing.mine.useQuery(undefined, { enabled: isSelf });
  const theirs = trpc.listing.bySeller.useQuery({ sellerId: userId }, { enabled: !isSelf });
  const listingsQuery = isSelf ? mine : theirs;
  const listings = isSelf
    ? (mine.data ?? []).filter((l) => l.status === 'active')
    : (theirs.data ?? []);

  const postsQuery = trpc.user.posts.useQuery({ userId }, { enabled: tab === 'posts' });
  const commentsQuery = trpc.user.comments.useQuery({ userId }, { enabled: tab === 'comments' });

  return (
    <View>
      <SegmentedTabs
        segments={[
          { key: 'listings', label: 'Listings' },
          { key: 'posts', label: 'Posts' },
          { key: 'comments', label: 'Comments' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={styles.body}>
        {tab === 'listings' ? (
          listingsQuery.isPending ? (
            <Skeleton height={180} />
          ) : listingsQuery.isError ? (
            <ErrorState message={listingsQuery.error.message} onRetry={() => listingsQuery.refetch()} />
          ) : listings.length === 0 ? (
            <EmptyState
              title={isSelf ? 'Nothing for sale right now' : `${firstName} has nothing for sale right now`}
              body={
                isSelf
                  ? 'When you list something, it shows up here for everyone on campus.'
                  : 'Check back later, or ask on the community board.'
              }
            />
          ) : (
            <FlatList
              data={listings}
              keyExtractor={(item) => item.id}
              numColumns={2}
              scrollEnabled={false}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
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
          )
        ) : tab === 'comments' ? (
          commentsQuery.isPending ? (
            <Skeleton height={90} />
          ) : commentsQuery.isError ? (
            <ErrorState message={commentsQuery.error.message} onRetry={() => commentsQuery.refetch()} />
          ) : commentsQuery.data.length === 0 ? (
            <EmptyState
              title={isSelf ? "You haven't commented lately" : `${firstName} hasn't commented lately`}
              body="Comments live as long as the post they're on, so this fills up whenever someone joins a conversation."
            />
          ) : (
            <View style={styles.posts}>
              {commentsQuery.data.map((c) => (
                <Card key={c.id} style={styles.post}>
                  <Text variant="caption" color="inkFaint" numberOfLines={2}>
                    On: {c.postExcerpt}
                  </Text>
                  <Text variant="body" style={styles.postBody}>
                    {c.body}
                  </Text>
                  <View style={styles.postTop}>
                    <Text variant="caption" color="inkFaint">
                      {formatRelative(c.createdAt)} · {timeLeftLabel(c.postExpiresAt, now)}
                    </Text>
                    {c.voteCount > 0 ? (
                      <Text variant="caption" color="inkMuted">
                        {c.voteCount} {c.voteCount === 1 ? 'upvote' : 'upvotes'}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          )
        ) : postsQuery.isPending ? (
          <Skeleton height={110} />
        ) : postsQuery.isError ? (
          <ErrorState message={postsQuery.error.message} onRetry={() => postsQuery.refetch()} />
        ) : postsQuery.data.length === 0 ? (
          <EmptyState
            title={isSelf ? "You haven't posted lately" : `${firstName} hasn't posted lately`}
            body="Community posts last 24 hours, so this fills up whenever someone asks around."
          />
        ) : (
          <View style={styles.posts}>
            {postsQuery.data.map((post) => (
              <Card key={post.id} style={styles.post}>
                <View style={styles.postTop}>
                  <Badge
                    kind="status"
                    label={post.kind === 'buying' ? 'Looking to buy' : 'Selling'}
                    tone={post.kind === 'buying' ? 'warning' : 'success'}
                  />
                  <Text variant="caption" color="inkFaint">
                    {formatRelative(post.createdAt)} · {timeLeftLabel(post.expiresAt, now)}
                  </Text>
                </View>
                <Text variant="body" style={styles.postBody}>
                  {post.body}
                </Text>
                {post.voteCount > 0 ? (
                  <Text variant="caption" color="inkMuted">
                    {post.voteCount} {post.voteCount === 1 ? 'upvote' : 'upvotes'}
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.lg },
  gridRow: { gap: space.md },
  gridContent: { gap: space.md },
  // maxWidth pins a lone cell to half the row (see the other grids).
  gridCell: { flex: 1, maxWidth: '50%' },
  posts: { gap: space.md },
  post: { gap: space.sm },
  postTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  postBody: { lineHeight: 22 },
});

export default ProfileContent;
