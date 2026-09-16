/**
 * Sell-form photo picker: horizontal row of 4:5 photo tiles + an "Add photos"
 * tile. Each picked image uploads immediately via `uploadImage` with a
 * per-tile spinner and a retry affordance on failure. First photo is the
 * cover. Long-press reorder is intentionally skipped (out of scope per spec).
 *
 * Controlled component: parent owns `photos` and receives `onChange`. This
 * keeps upload orchestration local to the tile so ListingForm only ever sees
 * `{ url, status }` entries it can turn into `photoUrls` for the mutation.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, RotateCw } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';
import { resolveMediaUrl, uploadImage } from '@/lib/trpc';

export interface PhotoItem {
  /** Stable local key (not sent to the server). */
  key: string;
  /** Local file uri, present while status is 'uploading' or 'error'. */
  localUri?: string;
  /** Server-relative URL, present once status is 'done'. */
  url?: string;
  status: 'uploading' | 'done' | 'error';
}

export interface PhotoPickerRowProps {
  photos: PhotoItem[];
  onChange: (photos: PhotoItem[]) => void;
  max?: number;
  error?: string;
}

const TILE_WIDTH = 96;
const TILE_HEIGHT = 120; // 4:5

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `photo-${Date.now()}-${keySeq}`;
}

export function PhotoPickerRow({ photos, onChange, max = 8, error }: PhotoPickerRowProps) {
  const remaining = Math.max(0, max - photos.length);

  // uploadOne resolves asynchronously (a network round-trip after the tile
  // was added), so a closure over `photos` from the render that kicked off
  // the upload would be stale by the time it resolves and could wipe out
  // the tile it's meant to update (or ones added after it). Read the latest
  // array from a ref instead of the closed-over prop.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const uploadOne = useCallback(
    async (key: string, localUri: string) => {
      try {
        const url = await uploadImage(localUri);
        onChange(
          photosRef.current.map((p) => (p.key === key ? { ...p, url, status: 'done' as const } : p)),
        );
      } catch {
        onChange(photosRef.current.map((p) => (p.key === key ? { ...p, status: 'error' as const } : p)));
      }
    },
    [onChange],
  );

  const handleAdd = useCallback(async () => {
    if (remaining <= 0) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow photo library access in Settings to add pictures to your listing.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) return;

    const newItems: PhotoItem[] = result.assets.map((asset) => ({
      key: nextKey(),
      localUri: asset.uri,
      status: 'uploading',
    }));

    const merged = [...photos, ...newItems];
    onChange(merged);

    newItems.forEach((item) => {
      if (item.localUri) uploadOne(item.key, item.localUri);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, remaining, onChange]);

  const handleRemove = useCallback(
    (key: string) => {
      onChange(photos.filter((p) => p.key !== key));
    },
    [photos, onChange],
  );

  const handleRetry = useCallback(
    (key: string) => {
      const item = photos.find((p) => p.key === key);
      if (!item?.localUri) return;
      onChange(photos.map((p) => (p.key === key ? { ...p, status: 'uploading' as const } : p)));
      uploadOne(key, item.localUri);
    },
    [photos, uploadOne, onChange],
  );

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((photo, index) => (
          <View key={photo.key} style={styles.tileWrap}>
            <View style={[styles.tile, photo.status === 'error' && styles.tileError]}>
              <Image
                source={{ uri: photo.status === 'done' ? resolveMediaUrl(photo.url) : photo.localUri }}
                style={styles.image}
                contentFit="cover"
                transition={150}
                accessibilityLabel={index === 0 ? 'Cover photo' : `Photo ${index + 1}`}
              />
              {photo.status === 'uploading' ? (
                <View style={styles.overlay}>
                  <ActivityIndicator color={colors.white} />
                </View>
              ) : null}
              {photo.status === 'error' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry upload"
                  style={styles.overlay}
                  onPress={() => handleRetry(photo.key)}
                >
                  <RotateCw size={22} color={colors.white} />
                  <Text variant="caption" color="white" style={styles.retryLabel}>
                    Retry
                  </Text>
                </Pressable>
              ) : null}
              {index === 0 && photo.status === 'done' ? (
                <View style={styles.coverBadge}>
                  <Text variant="caption" weight="600" color="white">
                    Cover
                  </Text>
                </View>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => handleRemove(photo.key)}
              hitSlop={12}
              style={styles.removeButton}
            >
              <X size={14} color={colors.white} />
            </Pressable>
          </View>
        ))}

        {remaining > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos"
            onPress={handleAdd}
            style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
          >
            <Plus size={24} color={colors.inkMuted} />
            <Text variant="caption" color="inkMuted" style={styles.addLabel}>
              Add photos
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : (
        <Text variant="caption" color="inkFaint" style={styles.error}>
          {photos.length}/{max} photos · first photo is the cover
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingVertical: space.xs },
  tileWrap: { width: TILE_WIDTH },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  tileError: { borderWidth: 1, borderColor: colors.danger },
  image: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(22,21,19,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { marginTop: 4 },
  coverBadge: {
    position: 'absolute',
    left: space.xs,
    bottom: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,21,19,0.6)',
  },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.8 },
  addLabel: { marginTop: space.xs },
  error: { marginTop: space.sm },
});

export default PhotoPickerRow;
