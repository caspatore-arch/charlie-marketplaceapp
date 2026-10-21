/**
 * One community post: kind badge, body, author (tap -> profile), age and
 * "Xh left" countdown, and an overflow button that opens the actions sheet
 * (Delete for your own post; Report / Block for someone else's).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { colors, space } from '@/constants/theme';
import { formatRelative } from '@/utils/format';
import { timeLeftLabel } from './useNow';
import type { CommunityPost } from '@/types';

export interface PostCardProps {
  post: CommunityPost;
  now: number;
  onPressAuthor: () => void;
  onOpenActions: () => void;
}

export function PostCard({ post, now, onPressAuthor, onOpenActions }: PostCardProps) {
  const buying = post.kind === 'buying';
  const left = timeLeftLabel(post.expiresAt, now);
  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <Badge kind="status" label={buying ? 'Looking to buy' : 'Selling'} tone={buying ? 'warning' : 'success'} />
        <View style={styles.spacer} />
        <Text variant="caption" color="inkFaint">
          {formatRelative(post.createdAt)} · {left}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More actions for this post"
          onPress={onOpenActions}
          hitSlop={8}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <MoreHorizontal size={20} color={colors.inkMuted} />
        </Pressable>
      </View>

      <Text variant="body" style={styles.body}>
        {post.body}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${post.author.displayName}'s profile`}
        onPress={onPressAuthor}
        style={({ pressed }) => [styles.author, pressed && styles.pressed]}
      >
        <Avatar uri={post.author.avatarUrl} name={post.author.displayName} size={28} />
        <Text variant="label" color="inkMuted" numberOfLines={1} style={styles.authorName}>
          {post.isMine ? `${post.author.displayName} (you)` : post.author.displayName}
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  spacer: { flex: 1 },
  more: { width: 48, height: 48, marginVertical: -space.md, marginRight: -space.md, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  body: { lineHeight: 22 },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, alignSelf: 'flex-start' },
  authorName: { flexShrink: 1 },
});

export default PostCard;
