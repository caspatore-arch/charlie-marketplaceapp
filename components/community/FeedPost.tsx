/**
 * A feed row: the existing PostCard with the upvote control in its footer row
 * (author on the left, vote on the right, never overlaid),
 * and a "N comments" toggle underneath that opens the thread inline. Inline,
 * not a detail route, because posts stay up and the feed is where people
 * already are: a reply should never cost a navigation and a lost scroll spot.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown, ChevronUp, MessageCircle } from 'lucide-react-native';
import { PostCard, type PostCardProps } from './PostCard';
import { VoteButton } from './VoteButton';
import { CommentThread } from './CommentThread';
import { Text } from '@/components/ui/Text';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';

export function FeedPost(props: PostCardProps) {
  const { post } = props;
  const [open, setOpen] = useState(false);
  // Share the thread's cache so the label tracks adds/deletes without refetching the feed.
  const thread = trpc.community.comments.useQuery({ postId: post.id }, { enabled: open });
  const count = thread.data?.length ?? post.commentCount;
  const label = count === 0 ? 'Comment' : `${count} ${count === 1 ? 'comment' : 'comments'}`;
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View>
      <PostCard
        {...props}
        footerRight={<VoteButton postId={post.id} voteCount={post.voteCount} viewerVoted={post.viewerVoted} />}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${open ? 'Hide' : 'Show'} comments.`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
      >
        <MessageCircle size={18} color={colors.inkMuted} />
        <Text variant="label" color="inkMuted">
          {label}
        </Text>
        <Chevron size={18} color={colors.inkMuted} />
      </Pressable>
      {open ? <CommentThread postId={post.id} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 48,
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
  },
  pressed: { opacity: 0.7 },
});

export default FeedPost;
