/**
 * Usage: <MessageBubble body={msg.body} createdAt={msg.createdAt} isOwn={msg.senderId === user.id} />
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { formatRelative } from '@/utils/format';

export interface MessageBubbleProps {
  body: string;
  createdAt: string;
  isOwn: boolean;
}

export function MessageBubble({ body, createdAt, isOwn }: MessageBubbleProps) {
  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text variant="body" color={isOwn ? 'white' : 'ink'}>
          {body}
        </Text>
      </View>
      <Text variant="caption" color="inkFaint" style={styles.time}>
        {formatRelative(createdAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { maxWidth: '80%', marginVertical: space.xs },
  rowOwn: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleOwn: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surfaceMuted, borderBottomLeftRadius: 4 },
  time: { marginTop: 2, marginHorizontal: 4 },
});

export default MessageBubble;
