/**
 * Upvote control for a comment. Same contract as VoteButton: popularity only
 * (never an endorsement or safety signal), sends the TARGET state to an
 * idempotent endpoint, optimistic, ignores taps while in flight, rolls back on
 * failure, and sends a signed-out viewer to sign-in. Voted differs from idle by
 * shape (filled arrow) and fill, not colour alone. 48px tall touch target.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ArrowBigUp } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';

export interface CommentVoteButtonProps {
  commentId: string;
  voteCount: number;
  viewerVoted: boolean;
  returnTo?: string;
}

export function CommentVoteButton({ commentId, voteCount, viewerVoted, returnTo = '/community' }: CommentVoteButtonProps) {
  const requireAuth = useRequireAuth();
  const [state, setState] = useState({ count: voteCount, voted: viewerVoted });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setState({ count: voteCount, voted: viewerVoted });
  }, [voteCount, viewerVoted]);

  const mutation = trpc.community.setCommentVote.useMutation({
    onSuccess: (res) => {
      setFailed(false);
      setState({ count: res.voteCount, voted: res.viewerVoted });
    },
    onError: (e) => {
      setState({ count: voteCount, voted: viewerVoted });
      if (e.data?.code === 'UNAUTHORIZED') requireAuth(returnTo);
      else setFailed(true);
    },
  });

  const onPress = () => {
    if (!requireAuth(returnTo) || mutation.isPending) return;
    const next = !state.voted;
    setFailed(false);
    setState((s) => ({ voted: next, count: Math.max(0, s.count + (next ? 1 : -1)) }));
    mutation.mutate({ id: commentId, voted: next });
  };

  const noun = state.count === 1 ? 'upvote' : 'upvotes';
  const label = failed
    ? `Couldn't save your upvote. ${state.count} ${noun}. Try again.`
    : state.voted
      ? `You upvoted this. ${state.count} ${noun}. Tap to remove your upvote.`
      : `Upvote. ${state.count} ${noun}.`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: state.voted, busy: mutation.isPending }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, state.voted ? styles.voted : styles.idle, pressed && styles.pressed]}
    >
      <ArrowBigUp size={20} color={state.voted ? colors.white : colors.ink} fill={state.voted ? colors.white : 'none'} />
      <Text variant="label" weight="700" color={state.voted ? 'white' : 'ink'} style={styles.count}>
        {state.count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 56,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: 1.5,
  },
  idle: { backgroundColor: colors.surface, borderColor: colors.line },
  voted: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.8 },
  count: { fontVariant: ['tabular-nums'] },
});

export default CommentVoteButton;
