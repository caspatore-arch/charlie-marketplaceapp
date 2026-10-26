/**
 * Up/down vote control shared by posts and comments: up arrow, net score, down
 * arrow. Popularity only: the score is never an endorsement or a safety
 * signal, so nothing here says "trusted" or "verified".
 *
 * The server keeps one vote per (item, person) behind a database UNIQUE key
 * and the endpoint is idempotent, so this sends the TARGET value (1, -1 or 0 to
 * clear), never "toggle". Tapping your active arrow clears the vote; tapping
 * the other arrow switches it. Updates optimistically, ignores taps while a
 * request is in flight, rolls back on failure, and sends a signed-out viewer to
 * sign-in. Each arrow is a 48pt touch target. Up active = accent; down active
 * = ink (not the error red). Active differs from idle by a filled arrow, not
 * colour alone.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { useRequireAuth } from '@/hooks/useAuth';
import { colors, space } from '@/constants/theme';

export type VoteTarget = 1 | -1 | 0;

export interface VoteResult {
  score: number;
  viewerVote: number;
}

export interface VoteControlProps {
  score: number;
  /** The viewer's current vote: 1, -1 or 0. */
  viewerVote: number;
  /** Sends the target vote to the server. Rejects on failure. */
  submit: (value: VoteTarget) => Promise<VoteResult>;
  /** Where to return after signing in. */
  returnTo?: string;
  /** Noun for screen readers, e.g. "post" or "comment". */
  noun?: string;
}

const asVote = (n: number): VoteTarget => (n > 0 ? 1 : n < 0 ? -1 : 0);

export function VoteControl({ score, viewerVote, submit, returnTo = '/community', noun = 'post' }: VoteControlProps) {
  const requireAuth = useRequireAuth();
  const [state, setState] = useState({ score, vote: asVote(viewerVote) });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Re-sync whenever fresh data arrives from the server (adjust state during
  // render, the React-recommended alternative to an effect).
  const [seen, setSeen] = useState({ score, viewerVote });
  if (seen.score !== score || seen.viewerVote !== viewerVote) {
    setSeen({ score, viewerVote });
    setState({ score, vote: asVote(viewerVote) });
  }

  const press = (tapped: 1 | -1) => {
    if (!requireAuth(returnTo) || pending) return;
    const next: VoteTarget = state.vote === tapped ? 0 : tapped;
    const before = state;
    setFailed(false);
    setPending(true);
    setState({ vote: next, score: before.score + next - before.vote });
    submit(next)
      .then((res) => setState({ score: res.score, vote: asVote(res.viewerVote) }))
      .catch((e: { data?: { code?: string } }) => {
        setState(before);
        if (e?.data?.code === 'UNAUTHORIZED') requireAuth(returnTo);
        else setFailed(true);
      })
      .finally(() => setPending(false));
  };

  const mine = state.vote === 1 ? ', you upvoted' : state.vote === -1 ? ', you downvoted' : '';
  const summary = failed ? `Couldn't save your vote. Score ${state.score}${mine}. Try again.` : `Score ${state.score}${mine}`;

  return (
    <View accessible={false} style={styles.row} accessibilityLabel={`${noun} votes`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state.vote === 1 ? 'Upvote, selected. Tap to remove your upvote' : 'Upvote'}
        accessibilityState={{ selected: state.vote === 1, busy: pending }}
        onPress={() => press(1)}
        style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
      >
        <ArrowBigUp
          size={24}
          color={state.vote === 1 ? colors.accent : colors.inkMuted}
          fill={state.vote === 1 ? colors.accent : 'none'}
        />
      </Pressable>
      <Text
        variant="label"
        weight="700"
        color={state.vote === 1 ? 'accentInk' : 'ink'}
        accessibilityLabel={summary}
        accessibilityLiveRegion="polite"
        style={styles.score}
      >
        {state.score}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state.vote === -1 ? 'Downvote, selected. Tap to remove your downvote' : 'Downvote'}
        accessibilityState={{ selected: state.vote === -1, busy: pending }}
        onPress={() => press(-1)}
        style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
      >
        <ArrowBigDown
          size={24}
          color={state.vote === -1 ? colors.ink : colors.inkMuted}
          fill={state.vote === -1 ? colors.ink : 'none'}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  arrow: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  score: { minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

export default VoteControl;
