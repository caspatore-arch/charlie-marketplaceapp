/**
 * Up to two top comments under a listing: author and text only. Listing
 * comments have no upvotes, so there is no total to show. Nothing renders when
 * there are none (no empty placeholder). Tapping opens the listing, where the
 * full thread and replies live: this is the same thread, not a copy.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { colors, space } from '@/constants/theme';
import type { FeedListing } from '@/types';

export interface CommentPreviewProps {
  title: string;
  comments: FeedListing['engagement']['topComments'];
  /** All comments the viewer can read, replies included. */
  commentCount: number;
  onOpen: () => void;
  /** Larger type for places where comments lead (Community). */
  prominent?: boolean;
}

export function CommentPreview({ title, comments, commentCount, onOpen, prominent = false }: CommentPreviewProps) {
  if (comments.length === 0) return null;
  const more = commentCount > comments.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${commentCount === 1 ? '1 comment' : `${commentCount} comments`} on ${title}. Open the listing to read them all.`}
      onPress={onOpen}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      {comments.map((c) => (
        <Text key={c.id} variant={prominent ? 'body' : 'bodySm'} numberOfLines={prominent ? 3 : 2}>
          <Text variant={prominent ? 'body' : 'bodySm'} weight="700">
            {c.author.displayName}
          </Text>{' '}
          {c.body}
        </Text>
      ))}
      {more ? (
        <View>
          <Text variant="caption" color="inkMuted">
            View all {commentCount} comments
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  pressed: { opacity: 0.7 },
});

export default CommentPreview;
