/**
 * The compact post every new listing gets in Community. It is a view onto the
 * LISTING, not a copy: caption, price, photo, likes, shares and comments are
 * the listing's own, so it can never disagree with Browse or the listing page.
 *
 * Comments lead (the photo is a small thumbnail): the top comments sit in
 * readable type, and one tap opens the full thread inline, replies included.
 * Tapping the photo opens the listing itself. Report/Block go through the same
 * actions sheet as other posts (a report here is filed against the listing).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ChevronDown, ChevronUp, MessageCircle, MoreHorizontal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PriceText } from '@/components/ui/PriceText';
import { EngagementBar } from '@/components/engagement/EngagementBar';
import { CommentPreview } from '@/components/engagement/CommentPreview';
import { ListingComments } from '@/components/listing/ListingComments';
import { resolveMediaUrl } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';
import { formatRelative } from '@/utils/format';
import type { CommunityPost, FeedListing } from '@/types';

export interface ListingPostProps {
  post: CommunityPost;
  listing: NonNullable<CommunityPost['listing']>;
  engagement: FeedListing['engagement'];
  onPressAuthor: () => void;
  onOpenActions: () => void;
}

export function ListingPost({ post, listing, engagement, onPressAuthor, onOpenActions }: ListingPostProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const openListing = () => router.push(`/listing/${listing.id}`);
  // Past its 24 hours the listing is in the Archive; its post stays up with it.
  const archived = listing.status === 'expired';
  const count = engagement.commentCount;
  const label = count === 0 ? 'Comment' : `${count} ${count === 1 ? 'comment' : 'comments'}`;
  const Chevron = open ? ChevronUp : ChevronDown;
  // The title is the headline; the caption below is the listing's description when it adds something.
  const caption = post.body !== listing.title ? post.body : null;

  return (
    <View>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Badge kind="status" label={archived ? 'Archived' : 'New listing'} tone={archived ? 'neutral' : 'success'} />
          <View style={styles.spacer} />
          <Text variant="caption" color="inkFaint">
            {formatRelative(post.createdAt)}
          </Text>
          {post.isMine ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More actions for this post"
              onPress={onOpenActions}
              hitSlop={8}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <MoreHorizontal size={20} color={colors.inkMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.mainRow}>
          <View style={styles.text}>
            <Text variant="label" weight="700" numberOfLines={2}>
              {listing.title}
            </Text>
            <PriceText cents={listing.priceCents} />
            {caption ? (
              <Text variant="bodySm" color="inkMuted" numberOfLines={2}>
                {caption}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${post.author.displayName}'s profile`}
              onPress={onPressAuthor}
              style={({ pressed }) => [styles.author, pressed && styles.pressed]}
            >
              <Avatar uri={post.author.avatarUrl} name={post.author.displayName} size={22} />
              <Text variant="caption" color="inkMuted" numberOfLines={1} style={styles.authorName}>
                {post.isMine ? `${post.author.displayName} (you)` : post.author.displayName}
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open listing: ${listing.title}`}
            onPress={openListing}
            style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
          >
            <Image
              source={{ uri: resolveMediaUrl(listing.coverPhotoUrl) }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={listing.id}
            />
          </Pressable>
        </View>

        <EngagementBar listing={listing} engagement={engagement} returnTo="/community" />
        {open ? null : (
          <CommentPreview
            prominent
            title={listing.title}
            comments={engagement.topComments}
            commentCount={count}
            onOpen={() => setOpen(true)}
          />
        )}
      </Card>
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
      {open ? (
        <View style={styles.thread}>
          <ListingComments listingId={listing.id} canComment={listing.status === 'active' || listing.status === 'reserved'} showTitle={false} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  spacer: { flex: 1 },
  more: { width: 48, height: 48, marginVertical: -space.sm, marginRight: -space.md, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  mainRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: 2 },
  author: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32 },
  authorName: { flexShrink: 1 },
  // Deliberately small: in a Community post the conversation leads, not the photo.
  thumb: { width: 64, aspectRatio: 4 / 5, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 48,
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
  },
  thread: { paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.line, marginLeft: space.sm },
});

export default ListingPost;
