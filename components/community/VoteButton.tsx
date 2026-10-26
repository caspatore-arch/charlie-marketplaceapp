/**
 * Up/down vote control for a community post (see VoteControl). Popularity
 * only: the score is never an endorsement or a safety signal.
 */
import React from 'react';
import { trpc } from '@/lib/trpc';
import { VoteControl } from './VoteControl';

export interface VoteButtonProps {
  postId: string;
  score: number;
  viewerVote: number;
  /** Where to return after signing in. */
  returnTo?: string;
}

export function VoteButton({ postId, score, viewerVote, returnTo = '/community' }: VoteButtonProps) {
  const mutation = trpc.community.setVote.useMutation();
  return (
    <VoteControl
      score={score}
      viewerVote={viewerVote}
      returnTo={returnTo}
      noun="post"
      submit={(value) => mutation.mutateAsync({ id: postId, value })}
    />
  );
}

export default VoteButton;
