/**
 * Upvote control for a community post. Popularity only: the count is never an
 * endorsement or a safety signal, so nothing here says "trusted" or "verified".
 *
 * The server stores one vote per (post, user) behind a database UNIQUE key and
 * `setVote` is idempotent, so this sends the TARGET state rather than "toggle".
 * The button updates optimistically, ignores taps while a request is in flight,
 * and rolls back on failure. A signed-out viewer is sent to sign-in.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ArrowBigUp } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { useRequireAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';

export interface VoteButtonProps {
  postId: string;
  voteCount: number;
  viewerVoted: boolean;
  /** Where to return after signing in. */
  returnTo?: string;
}

export function VoteButton({ postId, voteCount, viewerVoted, returnTo = '/community' }: VoteButtonProps) {
  const requireAuth = useRequireAuth();
  const [state, setState] = useState({ count: voteCount, voted: viewerVoted });
  const [failed, setFailed] = useState(false);

  // Re-sync whenever fresh data arrives from the server.
  useEffect(() => {
    setState({ count: voteCount, voted: viewerVoted });
  }, [voteCount, viewerVoted]);

  const mutation = trpc.community.setVote.useMutation({
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
    mutation.mutate({ id: postId, voted: next });
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
      <ArrowBigUp
        size={22}
        color={state.voted ? colors.white : colors.ink}
        // Filled arrow = voted; outline = not voted (shape, not just colour).
        fill={state.voted ? colors.white : 'none'}
      />
      <Text variant="label" weight="700" color={state.voted ? 'white' : 'ink'} style={styles.count}>
        {state.count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: space.md,
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

export default VoteButton;
