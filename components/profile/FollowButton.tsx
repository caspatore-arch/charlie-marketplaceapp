/**
 * Follow / Following toggle. The two states differ by more than colour:
 * Follow is a solid accent fill with a "+" icon; Following is an outlined,
 * white button with a check mark and a heavier border. Following is
 * popularity bookkeeping only, never a safety or trust signal.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Check, UserPlus } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { trpc } from '@/lib/trpc';
import { useRequireAuth } from '@/hooks/useAuth';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';

export function FollowButton({
  userId,
  viewerFollows,
  displayName,
}: {
  userId: string;
  viewerFollows: boolean;
  displayName: string;
}) {
  const requireAuth = useRequireAuth();
  const utils = trpc.useUtils();
  const onDone = () => {
    void utils.user.byId.invalidate({ id: userId });
    void utils.user.followList.invalidate();
  };
  const follow = trpc.user.follow.useMutation({ onSuccess: onDone });
  const unfollow = trpc.user.unfollow.useMutation({ onSuccess: onDone });
  const busy = follow.isPending || unfollow.isPending;

  const toggle = () => {
    if (busy) return;
    if (!requireAuth(`/user/${userId}`)) return;
    if (viewerFollows) unfollow.mutate({ userId });
    else follow.mutate({ userId });
  };

  const error = follow.error?.message ?? unfollow.error?.message;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={viewerFollows ? `Following ${displayName}. Tap to unfollow.` : `Follow ${displayName}`}
        accessibilityState={{ selected: viewerFollows, busy }}
        onPress={toggle}
        style={({ pressed }) => [
          styles.base,
          viewerFollows ? styles.following : styles.follow,
          pressed && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={viewerFollows ? colors.ink : colors.white} />
        ) : viewerFollows ? (
          <Check size={18} color={colors.ink} />
        ) : (
          <UserPlus size={18} color={colors.white} />
        )}
        <Text variant="heading" weight={viewerFollows ? '700' : '600'} color={viewerFollows ? 'ink' : 'white'}>
          {viewerFollows ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: minTouchHeight,
    minWidth: 150,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  follow: { backgroundColor: colors.accent, borderColor: colors.accent },
  following: { backgroundColor: colors.surface, borderColor: colors.ink },
  pressed: { opacity: 0.85 },
  error: { marginTop: space.xs, textAlign: 'center' },
});

export default FollowButton;
