/**
 * Celebration shown right after a listing is published: congratulations, a
 * read-only preview of what was just posted, share options (link chips, then an
 * optional story image and an optional "email your video" mailto), and the 24-hour
 * reminder. Dismissing (primary button, backdrop, or Android back) always
 * routes through `onViewListing`, so nobody is left on a dead form screen.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, shadow, space } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { PriceText } from '@/components/ui/PriceText';
import { resolveMediaUrl } from '@/lib/trpc';
import { listingShareUrl } from '@/utils/shareListing';
import { formatPrice } from '@/utils/format';
import { Confetti } from './Confetti';
import { ShareRow } from './ShareRow';
import { StorySection } from './StorySection';
import { VideoEmailSection } from './VideoEmailSection';

export interface PublishedListing {
  id: string;
  title: string;
  priceCents: number;
  coverPhotoUrl: string | null;
}

interface Props {
  listing: PublishedListing | null;
  onViewListing: () => void;
  onBackToFeed: () => void;
}

export function PostPublishModal({ listing, onViewListing, onBackToFeed }: Props) {
  if (!listing) return null;
  const content = {
    title: listing.title,
    text: `${listing.title} for ${formatPrice(listing.priceCents)} on Dibbs`,
    url: listingShareUrl(listing.id),
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onViewListing}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close and view your listing"
          onPress={onViewListing}
        />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text variant="title" style={styles.center} accessibilityRole="header">
              Congrats, your listing is live!
            </Text>

            <View style={styles.preview}>
              <View style={styles.photo}>
                {listing.coverPhotoUrl ? (
                  <Image
                    source={{ uri: resolveMediaUrl(listing.coverPhotoUrl) }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    accessibilityLabel={`Photo of ${listing.title}`}
                  />
                ) : null}
              </View>
              <View style={styles.previewText}>
                <PriceText cents={listing.priceCents} />
                <Text variant="label" numberOfLines={2}>
                  {listing.title}
                </Text>
              </View>
            </View>

            <Text variant="label" color="inkMuted" style={styles.reminder}>
              It stays up for 24 hours, then it expires. Share it now while buyers are around.
            </Text>

            <Text variant="heading">Send your listing to a friend</Text>
            <Text selectable variant="caption" color="accentInk">{content.url}</Text>
            <ShareRow content={content} listingId={listing.id} />

            <StorySection listing={listing} />
            <VideoEmailSection title={listing.title} url={content.url} />

            <Button title="View my listing" size="lg" onPress={onViewListing} />
            <Button title="Back to the feed" variant="ghost" onPress={onBackToFeed} />
          </ScrollView>
        </View>
        <Confetti />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
    backgroundColor: 'rgba(22,21,19,0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow,
  },
  content: { padding: space.xl, gap: space.lg },
  center: { textAlign: 'center' },
  preview: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  photo: {
    width: 72,
    aspectRatio: 4 / 5,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.line,
  },
  previewText: { flex: 1, gap: 2 },
  reminder: { textAlign: 'center' },
});
