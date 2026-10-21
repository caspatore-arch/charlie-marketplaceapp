/**
 * Inline comments for one community post: the list, then a composer. Rendered
 * under the post in the feed so nobody has to leave the feed to join in.
 *
 * Rules live on the server (comments inherit the post's expiry/removal and the
 * viewer's blocks); this component only shows what it is given. Counts and
 * upvotes are popularity, never trust or safety.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { confirmAction } from '@/utils/confirm';
import { formatRelative } from '@/utils/format';
import { colors, radius, space } from '@/constants/theme';
import { CommentVoteButton } from './CommentVoteButton';
import type { RouterOutputs } from '@/types';

export type CommunityComment = RouterOutputs['community']['comments'][number];

const MAX = 500;

export function CommentThread({ postId }: { postId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const requireAuth = useRequireAuth();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const comments = trpc.community.comments.useQuery({ postId });
  const refresh = () => {
    void utils.community.comments.invalidate({ postId });
    void utils.user.comments.invalidate();
  };

  const add = trpc.community.addComment.useMutation({
    onSuccess: () => {
      setBody('');
      setError(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const remove = trpc.community.removeComment.useMutation({
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });

  const trimmed = body.trim();
  const returnTo = '/community';

  return (
    <View style={styles.wrap}>
      {comments.isPending ? (
        <Skeleton height={56} />
      ) : comments.isError ? (
        <ErrorState message={comments.error.message} onRetry={() => comments.refetch()} />
      ) : comments.data.length === 0 ? (
        <Text variant="label" color="inkMuted">
          No comments yet. Be the first to reply.
        </Text>
      ) : (
        comments.data.map((c) => (
          <View key={c.id} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${c.author.displayName}'s profile`}
              onPress={() => router.push(`/user/${c.author.id}`)}
              hitSlop={4}
            >
              <Avatar uri={c.author.avatarUrl} name={c.author.displayName} size={28} />
            </Pressable>
            <View style={styles.main}>
              <View style={styles.meta}>
                <Text variant="label" weight="700" numberOfLines={1} style={styles.name}>
                  {c.isMine ? `${c.author.displayName} (you)` : c.author.displayName}
                </Text>
                <Text variant="caption" color="inkFaint">
                  {formatRelative(c.createdAt)}
                </Text>
              </View>
              <Text variant="body" style={styles.text}>
                {c.body}
              </Text>
              {c.isMine ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete your comment"
                  onPress={() =>
                    confirmAction('Delete this comment?', 'It will disappear for everyone.', 'Delete', () =>
                      remove.mutate({ id: c.id }),
                    )
                  }
                  style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
                >
                  <Text variant="label" color="inkMuted">
                    Delete
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <CommentVoteButton commentId={c.id} voteCount={c.voteCount} viewerVoted={c.viewerVoted} returnTo={returnTo} />
          </View>
        ))
      )}

      <View style={styles.composer}>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={MAX}
          allowFontScaling
          accessibilityLabel="Write a comment"
          placeholder="Add a comment"
          placeholderTextColor={colors.inkFaint}
          // Tapping the field while signed out goes to sign-in instead.
          onFocus={() => {
            requireAuth(returnTo);
          }}
          style={styles.input}
        />
        <View style={styles.footer}>
          <Text variant="caption" color={body.length >= MAX - 20 ? 'danger' : 'inkMuted'} accessibilityLabel={`${body.length} of ${MAX} characters`}>
            {body.length}/{MAX}
          </Text>
          <Button
            title="Comment"
            onPress={() => {
              if (!requireAuth(returnTo)) return;
              setError(null);
              add.mutate({ postId, body: trimmed });
            }}
            disabled={trimmed.length === 0}
            loading={add.isPending}
          />
        </View>
        {error ? (
          <Text variant="label" color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.line, marginLeft: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  main: { flex: 1, gap: 2, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flexShrink: 1 },
  text: { lineHeight: 22 },
  delete: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  composer: { gap: space.sm },
  input: {
    minHeight: 48,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

export default CommentThread;
