/**
 * The seller's private photos and short video. Photos are large and tappable
 * (open full size in a new tab/viewer); the video is a tile that opens the
 * signed link, since the app has no in-app video player. URLs are short-lived
 * signed paths, so they are rendered through resolveMediaUrl at render time.
 */
import React from 'react';
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { breakpoints, colors, radius, space } from '@/constants/theme';
import { resolveMediaUrl } from '@/lib/trpc';
import type { StaffDetail } from './format';

function durationText(ms: number | null): string {
  if (ms == null) return '';
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function MediaGrid({ media }: { media: StaffDetail['media'] }) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.md;
  const tileStyle = wide ? styles.tileWide : styles.tile;

  if (media.length === 0) {
    return (
      <Text variant="body" color="inkMuted">
        No photos or video on this request. See the linked public listing for photos.
      </Text>
    );
  }

  const photos = media.filter((m) => m.kind === 'image');
  const photoCount = photos.length;

  return (
    <View style={styles.grid}>
      {media.map((m) => {
        const url = resolveMediaUrl(m.url);
        if (m.kind === 'video') {
          const d = durationText(m.durationMs);
          return (
            <Pressable
              key={m.id}
              accessibilityRole="link"
              accessibilityLabel={`Play video${d ? `, ${d}` : ''}. Opens in a new window.`}
              onPress={() => url && void Linking.openURL(url)}
              style={({ pressed }) => [styles.video, tileStyle, pressed && styles.pressed]}
            >
              <Play size={36} color={colors.white} fill={colors.white} />
              <Text variant="label" weight="600" color="white">
                {`Video${d ? ` · ${d}` : ''}`}
              </Text>
              <Text variant="caption" color="white">
                Tap to open
              </Text>
            </Pressable>
          );
        }
        const photoNumber = photos.indexOf(m) + 1;
        return (
          <Pressable
            key={m.id}
            accessibilityRole="link"
            accessibilityLabel={`Photo ${photoNumber} of ${photoCount}. Opens full size in a new window.`}
            onPress={() => url && void Linking.openURL(url)}
            style={({ pressed }) => [styles.photo, tileStyle, pressed && styles.pressed]}
          >
            <Image source={{ uri: url }} style={styles.img} contentFit="contain" cachePolicy="memory-disk" recyclingKey={m.id} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '100%', aspectRatio: 4 / 3 },
  tileWide: { width: '48.5%', aspectRatio: 4 / 3 },
  photo: { borderRadius: radius.md, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
  video: {
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  pressed: { opacity: 0.85 },
});

export default MediaGrid;
