/**
 * Public questions and comments on a listing, with one level of replies.
 * The server owns the rules (campus-verified to write, closed once the item is
 * sold or expired, blocks hidden); this only shows what it is given.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ThreadedComments } from '@/components/community/ThreadedComments';
import { useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { space } from '@/constants/theme';

export function ListingComments({
  listingId,
  canComment,
  showTitle = true,
}: {
  listingId: string;
  canComment: boolean;
  /** The listing page titles its own section; the Community feed shows the thread under a post and does not. */
  showTitle?: boolean;
}) {
  const utils = trpc.useUtils();
  const requireAuth = useRequireAuth();
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(0);

  const comments = trpc.listingComment.list.useQuery({ listingId });
  // The same thread backs Browse's previews and Community's listing posts, so
  // their counts and top comments are refreshed along with the thread.
  const refresh = () => {
    void utils.listingComment.list.invalidate({ listingId });
    void utils.listing.feed.invalidate();
    void utils.community.feed.invalidate();
  };

  const add = trpc.listingComment.add.useMutation({
    onSuccess: () => {
      setCleared((n) => n + 1);
      setError(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const remove = trpc.listingComment.remove.useMutation({
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });

  const returnTo = `/listing/${listingId}`;

  return (
    <View style={styles.wrap}>
      {showTitle ? (
        <Text variant="title">
          Questions & comments{comments.data ? ` (${comments.data.length})` : ''}
        </Text>
      ) : null}
      {comments.isPending ? (
        <Skeleton height={56} />
      ) : comments.isError ? (
        <ErrorState message={comments.error.message} onRetry={() => comments.refetch()} />
      ) : (
        <ThreadedComments
          items={comments.data}
          emptyText="No questions yet."
          onDelete={(id) =>
            confirmAction('Delete this comment?', 'It will disappear for everyone.', 'Delete', () => remove.mutate({ id }))
          }
          closedText={canComment ? undefined : 'Comments are closed on this item.'}
          ensureAuth={() => requireAuth(returnTo)}
          onSubmit={(body, parentId) => add.mutate({ listingId, body, parentId })}
          submitting={add.isPending}
          clearSignal={cleared}
          error={error}
          clearError={() => setError(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
});

export default ListingComments;
