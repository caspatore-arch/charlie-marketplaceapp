/**
 * Up/down vote control for a comment (see VoteControl). Popularity only: the
 * score is never an endorsement or a safety signal.
 */
import React from 'react';
import { trpc } from '@/lib/trpc';
import { VoteControl } from './VoteControl';

export interface CommentVoteButtonProps {
  commentId: string;
  score: number;
  viewerVote: number;
  returnTo?: string;
}

export function CommentVoteButton({ commentId, score, viewerVote, returnTo = '/community' }: CommentVoteButtonProps) {
  const mutation = trpc.community.setCommentVote.useMutation();
  return (
    <VoteControl
      score={score}
      viewerVote={viewerVote}
      returnTo={returnTo}
      noun="comment"
      submit={(value) => mutation.mutateAsync({ id: commentId, value })}
    />
  );
}

export default CommentVoteButton;
