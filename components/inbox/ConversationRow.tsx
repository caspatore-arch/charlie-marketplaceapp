/**
 * One row in the Inbox > Messages list. Usage:
 * <ConversationRow conversation={c} onPress={() => router.push(`/conversation/${c.id}`)} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { resolveMediaUrl } from '@/lib/trpc';
import { formatRelative } from '@/utils/format';
import type { ConversationSummary } from '@/types';

export interface ConversationRowProps {
  conversation: ConversationSummary;
  onPress: () => void;
}

export function ConversationRow({ conversation, onPress }: ConversationRowProps) {
  const { listing, otherUser, lastMessage, unreadCount } = conversation;
  const hasUnread = unreadCount > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${otherUser.displayName} about ${listing.title}${hasUnread ? `, ${unreadCount} unread` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.thumbWrap}>
        <Image
          source={{ uri: resolveMediaUrl(listing.coverPhotoUrl) }}
          style={styles.thumb}
          contentFit="cover"
          transition={150}
        />
        <View style={styles.avatarBadge}>
          <Avatar uri={otherUser.avatarUrl} name={otherUser.displayName} size={22} />
        </View>
      </View>

      <View style={styles.info}>
        <View style={styles.topLine}>
          <Text variant="label" weight="600" numberOfLines={1} style={styles.name}>
            {otherUser.displayName}
          </Text>
          {lastMessage ? (
            <Text variant="caption" color="inkFaint">
              {formatRelative(lastMessage.createdAt)}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" color="inkMuted" numberOfLines={1}>
          {listing.title}
        </Text>
        <Text
          variant="body"
          color={hasUnread ? 'ink' : 'inkMuted'}
          weight={hasUnread ? '600' : '400'}
          numberOfLines={1}
          style={styles.preview}
        >
          {lastMessage ? lastMessage.body : 'Say hello to get started.'}
        </Text>
      </View>

      {hasUnread ? <View style={styles.unreadDot} accessibilityLabel="Unread" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    minHeight: 64,
  },
  pressed: { opacity: 0.85 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  avatarBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.bg,
    overflow: 'hidden',
  },
  info: { flex: 1, gap: 2 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  name: { flexShrink: 1 },
  preview: { marginTop: 1 },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
});

export default ConversationRow;
