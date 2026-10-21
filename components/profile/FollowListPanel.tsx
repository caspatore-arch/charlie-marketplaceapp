/**
 * Inline "Followers / Following" list under the profile header. People you
 * have blocked (or who blocked you) and closed accounts never appear; the
 * server enforces that, this only renders what it returns.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Card } from '@/components/ui/Card';
import { trpc } from '@/lib/trpc';
import { colors, minTouchHeight, space } from '@/constants/theme';

export type FollowDirection = 'followers' | 'following';

export function FollowListPanel({
  userId,
  direction,
  isSelf,
}: {
  userId: string;
  direction: FollowDirection;
  isSelf: boolean;
}) {
  const router = useRouter();
  const query = trpc.user.followList.useQuery({ userId, direction });

  const empty =
    direction === 'followers'
      ? isSelf
        ? 'No followers yet. They will show up here.'
        : 'No followers yet.'
      : isSelf
        ? "You're not following anyone yet."
        : 'Not following anyone yet.';

  return (
    <Card style={styles.card}>
      <Text variant="heading" style={styles.title}>
        {direction === 'followers' ? 'Followers' : 'Following'}
      </Text>
      {query.isPending ? (
        <Skeleton height={48} />
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 ? (
        <Text variant="body" color="inkMuted">
          {empty}
        </Text>
      ) : (
        <View>
          {query.data.map((u) => (
            <Pressable
              key={u.id}
              accessibilityRole="link"
              accessibilityLabel={`View ${u.displayName}'s profile`}
              onPress={() => router.push(`/user/${u.id}`)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Avatar uri={u.avatarUrl} name={u.displayName} size={36} />
              <Text variant="body" numberOfLines={1} style={styles.name}>
                {u.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, marginBottom: space.lg },
  title: { color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: minTouchHeight },
  name: { flex: 1 },
  pressed: { opacity: 0.7 },
});

export default FollowListPanel;
