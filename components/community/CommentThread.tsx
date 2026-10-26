/**
 * Inline comments for one community post: the list, then a composer. Rendered
 * under the post in the feed so nobody has to leave the feed to join in.
 *
 * Rules live on the server (comments inherit the post's expiry/removal and the
 * viewer's blocks); this component only shows what it is given. Counts and
 * upvotes are popularity, never trust or safety.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { colors, space } from '@/constants/theme';
import { CommentVoteButton } from './CommentVoteButton';
import { ThreadedComments } from './ThreadedComments';
import type { RouterOutputs } from '@/types';

export type CommunityComment = RouterOutputs['community']['comments'][number];

export function CommentThread({ postId }: { postId: string }) {
  const utils = trpc.useUtils();
  const requireAuth = useRequireAuth();
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(0);

  const comments = trpc.community.comments.useQuery({ postId });
  const refresh = () => {
    void utils.community.comments.invalidate({ postId });
    void utils.user.comments.invalidate();
  };

  const add = trpc.community.addComment.useMutation({
    onSuccess: () => {
      setCleared((n) => n + 1);
      setError(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const remove = trpc.community.removeComment.useMutation({
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });

  const returnTo = '/community';

  return (
    <View style={styles.wrap}>
      {comments.isPending ? (
        <Skeleton height={56} />
      ) : comments.isError ? (
        <ErrorState message={comments.error.message} onRetry={() => comments.refetch()} />
      ) : (
        <ThreadedComments
          items={comments.data.map((c) => ({ ...c, canRemove: c.isMine }))}
          emptyText="No comments yet. Be the first to reply."
          renderTrailing={(c) => {
            const full = comments.data.find((x) => x.id === c.id);
            return full ? (
              <CommentVoteButton commentId={full.id} score={full.score} viewerVote={full.viewerVote} returnTo={returnTo} />
            ) : null;
          }}
          onDelete={(id) =>
            confirmAction('Delete this comment?', 'It will disappear for everyone.', 'Delete', () => remove.mutate({ id }))
          }
          deleteLabel="Delete your comment"
          ensureAuth={() => requireAuth(returnTo)}
          onSubmit={(body, parentId) => add.mutate({ postId, body, parentId })}
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
  wrap: { paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.line, marginLeft: space.sm },
});

export default CommentThread;
