/**
 * A feed row: the existing PostCard with the upvote control pinned to its
 * bottom-right corner (the author button sits bottom-left and hugs its content).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PostCard, type PostCardProps } from './PostCard';
import { VoteButton } from './VoteButton';
import { space } from '@/constants/theme';

export function FeedPost(props: PostCardProps) {
  const { post } = props;
  return (
    <View>
      <PostCard {...props} />
      <View style={styles.vote} pointerEvents="box-none">
        <VoteButton postId={post.id} voteCount={post.voteCount} viewerVoted={post.viewerVoted} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  vote: { position: 'absolute', right: space.md, bottom: space.sm },
});

export default FeedPost;
