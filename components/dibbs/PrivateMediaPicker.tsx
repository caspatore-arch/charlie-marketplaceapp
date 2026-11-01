/**
 * Private photo/video picker for "Get a Dibbs offer" requests (and replies to
 * the team's questions). Each pick uploads immediately to the private-media
 * endpoint with a visible progress bar; a failed tile shows the server's error
 * with Try again and Remove. The request claims the finished ids on submit.
 *
 *   const uploads = usePrivateMediaUploads({ maxPhotos: 8, maxVideos: 1 });
 *   <PrivateMediaPicker uploads={uploads} />
 *   uploads.doneIds / uploads.uploading / uploads.failed
 *
 * Limits mirror lib/privateMedia.ts: photos up to 8 MB, one video up to 30 s and
 * 50 MB. The server re-checks all of it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Plus, RotateCw, Video, X } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextLink } from '@/components/ui/TextLink';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import {
  MAX_REQUEST_PHOTOS,
  MAX_REQUEST_VIDEOS,
  PRIVATE_PHOTO_MAX_BYTES,
  PRIVATE_VIDEO_MAX_BYTES,
  PRIVATE_VIDEO_MAX_SECONDS,
  uploadPrivateMedia,
} from '@/lib/privateMedia';
import { formatDuration } from './status';

export interface MediaItem {
  /** Stable local key (not sent to the server). */
  key: string;
  kind: 'image' | 'video';
  localUri: string;
  mimeType?: string | null;
  fileName?: string | null;
  durationMs: number | null;
  status: 'uploading' | 'done' | 'error';
  /** 0..1 while uploading. */
  progress: number;
  /** Server media id once status is 'done'. */
  id?: string;
  error?: string;
}

export interface PrivateMediaUploads {
  items: MediaItem[];
  /** Server ids of finished uploads, in the order they were added. */
  doneIds: string[];
  uploading: boolean;
  failed: boolean;
  photoCount: number;
  videoCount: number;
  maxPhotos: number;
  maxVideos: number;
  /** A short message about something that was skipped or blocked, if any. */
  notice: string | null;
  pickFromLibrary: () => Promise<void>;
  takeWithCamera: () => Promise<void>;
  retry: (key: string) => void;
  remove: (key: string) => void;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `media-${Date.now()}-${keySeq}`;
}

export function usePrivateMediaUploads(
  opts: { maxPhotos?: number; maxVideos?: number } = {},
): PrivateMediaUploads {
  const maxPhotos = opts.maxPhotos ?? MAX_REQUEST_PHOTOS;
  const maxVideos = opts.maxVideos ?? MAX_REQUEST_VIDEOS;
  const [items, setItems] = useState<MediaItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The ref is the source of truth so async upload callbacks and quick double
  // picks never work from a stale render's array.
  const itemsRef = useRef<MediaItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const commit = useCallback((next: MediaItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<MediaItem>) => {
      if (!itemsRef.current.some((i) => i.key === key)) return;
      commit(itemsRef.current.map((i) => (i.key === key ? { ...i, ...change } : i)));
    },
    [commit],
  );

  const startUpload = useCallback(
    (item: MediaItem) => {
      const ctl = new AbortController();
      controllers.current.set(item.key, ctl);
      uploadPrivateMedia(
        { uri: item.localUri, kind: item.kind, mimeType: item.mimeType, fileName: item.fileName },
        (progress) => patch(item.key, { progress }),
        ctl.signal,
      )
        .then((res) =>
          patch(item.key, {
            status: 'done',
            progress: 1,
            id: res.id,
            durationMs: res.durationMs ?? item.durationMs,
            error: undefined,
          }),
        )
        .catch((err: unknown) =>
          patch(item.key, {
            status: 'error',
            error: err instanceof Error && err.message ? err.message : 'The upload failed. Try again.',
          }),
        )
        .finally(() => controllers.current.delete(item.key));
    },
    [patch],
  );

  // Leaving the screen cancels anything still in flight.
  useEffect(() => {
    const map = controllers.current;
    return () => {
      map.forEach((c) => c.abort());
      map.clear();
    };
  }, []);

  const addAssets = useCallback(
    (assets: ImagePicker.ImagePickerAsset[]) => {
      const skipped: string[] = [];
      const added: MediaItem[] = [];
      let photos = itemsRef.current.filter((i) => i.kind === 'image').length;
      let videos = itemsRef.current.filter((i) => i.kind === 'video').length;
      for (const asset of assets) {
        const isVideo = asset.type === 'video';
        if (isVideo) {
          if (videos >= maxVideos) {
            skipped.push(maxVideos === 0 ? 'Videos can’t be added here.' : 'Only one video per request.');
            continue;
          }
          if (asset.duration != null && asset.duration > (PRIVATE_VIDEO_MAX_SECONDS + 0.5) * 1000) {
            skipped.push(`Videos can be up to ${PRIVATE_VIDEO_MAX_SECONDS} seconds. Trim it and try again.`);
            continue;
          }
          if (asset.fileSize != null && asset.fileSize > PRIVATE_VIDEO_MAX_BYTES) {
            skipped.push('That video is over 50 MB. Pick a shorter one.');
            continue;
          }
          videos += 1;
        } else {
          if (photos >= maxPhotos) {
            skipped.push(`Up to ${maxPhotos} photos.`);
            continue;
          }
          if (asset.fileSize != null && asset.fileSize > PRIVATE_PHOTO_MAX_BYTES) {
            skipped.push('A photo was over 8 MB, so it was skipped.');
            continue;
          }
          photos += 1;
        }
        added.push({
          key: nextKey(),
          kind: isVideo ? 'video' : 'image',
          localUri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          durationMs: isVideo ? (asset.duration ?? null) : null,
          status: 'uploading',
          progress: 0,
        });
      }
      setNotice(skipped.length ? [...new Set(skipped)].join(' ') : null);
      if (added.length === 0) return;
      commit([...itemsRef.current, ...added]);
      added.forEach(startUpload);
    },
    [commit, maxPhotos, maxVideos, startUpload],
  );

  const mediaTypes = useCallback((): ImagePicker.MediaType[] => {
    const hasVideo = itemsRef.current.some((i) => i.kind === 'video');
    return maxVideos > 0 && !hasVideo ? ['images', 'videos'] : ['images'];
  }, [maxVideos]);

  const pickFromLibrary = useCallback(async () => {
    setNotice(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice('Allow photo library access in Settings to add pictures.');
      return;
    }
    const remaining =
      Math.max(0, maxPhotos - itemsRef.current.filter((i) => i.kind === 'image').length) +
      (mediaTypes().includes('videos') ? 1 : 0);
    if (remaining <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaTypes(),
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      videoMaxDuration: PRIVATE_VIDEO_MAX_SECONDS,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    addAssets(result.assets);
  }, [addAssets, maxPhotos, mediaTypes]);

  const takeWithCamera = useCallback(async () => {
    setNotice(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNotice('Allow camera access in Settings to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: mediaTypes(),
      videoMaxDuration: PRIVATE_VIDEO_MAX_SECONDS,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    addAssets(result.assets);
  }, [addAssets, mediaTypes]);

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item || item.status !== 'error') return;
      const next: MediaItem = { ...item, status: 'uploading', progress: 0, error: undefined };
      commit(itemsRef.current.map((i) => (i.key === key ? next : i)));
      startUpload(next);
    },
    [commit, startUpload],
  );

  const remove = useCallback(
    (key: string) => {
      controllers.current.get(key)?.abort();
      controllers.current.delete(key);
      commit(itemsRef.current.filter((i) => i.key !== key));
    },
    [commit],
  );

  return {
    items,
    doneIds: items.filter((i) => i.status === 'done' && i.id).map((i) => i.id!),
    uploading: items.some((i) => i.status === 'uploading'),
    failed: items.some((i) => i.status === 'error'),
    photoCount: items.filter((i) => i.kind === 'image').length,
    videoCount: items.filter((i) => i.kind === 'video').length,
    maxPhotos,
    maxVideos,
    notice,
    pickFromLibrary,
    takeWithCamera,
    retry,
    remove,
  };
}

const TILE_WIDTH = 96;
const TILE_HEIGHT = 120;

function tileName(item: MediaItem, items: MediaItem[]): string {
  const same = items.filter((i) => i.kind === item.kind);
  const n = same.findIndex((i) => i.key === item.key) + 1;
  return item.kind === 'video' ? 'Video' : `Photo ${n}`;
}

export function PrivateMediaPicker({ uploads, error }: { uploads: PrivateMediaUploads; error?: string }) {
  const { items, photoCount, videoCount, maxPhotos, maxVideos } = uploads;
  const canAddPhoto = photoCount < maxPhotos;
  const canAddVideo = maxVideos > 0 && videoCount < maxVideos;
  const canAdd = canAddPhoto || canAddVideo;
  const failedItems = items.filter((i) => i.status === 'error');

  return (
    <View style={styles.wrap}>
      {items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {items.map((item) => {
            const name = tileName(item, items);
            const pct = Math.round(item.progress * 100);
            return (
              <View key={item.key} style={styles.tileWrap}>
                <View style={[styles.tile, item.status === 'error' && styles.tileError]}>
                  {item.kind === 'image' ? (
                    <Image
                      source={{ uri: item.localUri }}
                      style={styles.fill}
                      contentFit="cover"
                      accessibilityLabel={name}
                    />
                  ) : (
                    <View style={[styles.fill, styles.videoTile]} accessible accessibilityLabel={`${name}, ${formatDuration(item.durationMs) || 'short clip'}`}>
                      <Video size={28} color={colors.inkMuted} />
                      {item.durationMs ? (
                        <Text variant="caption" color="inkMuted" weight="600">
                          {formatDuration(item.durationMs)}
                        </Text>
                      ) : null}
                    </View>
                  )}

                  {item.status === 'uploading' ? (
                    <View
                      style={styles.overlay}
                      accessibilityRole="progressbar"
                      accessibilityLabel={`Uploading ${name}`}
                      accessibilityValue={{ min: 0, max: 100, now: pct }}
                    >
                      <Text variant="label" weight="600" color="white">
                        {`${pct}%`}
                      </Text>
                      <View style={styles.track}>
                        <View style={[styles.bar, { width: `${Math.max(4, pct)}%` }]} />
                      </View>
                    </View>
                  ) : null}

                  {item.status === 'error' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Upload failed. Try ${name} again`}
                      style={styles.overlay}
                      onPress={() => uploads.retry(item.key)}
                    >
                      <RotateCw size={22} color={colors.white} />
                      <Text variant="caption" color="white" style={styles.retryLabel}>
                        Try again
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${name}`}
                  onPress={() => uploads.remove(item.key)}
                  hitSlop={12}
                  style={styles.removeButton}
                >
                  <X size={14} color={colors.white} />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {failedItems.map((item) => (
        <View key={item.key} style={styles.failRow} accessibilityRole="alert">
          <Text variant="caption" color="danger" style={styles.failText}>
            {`${tileName(item, items)} didn’t upload. ${item.error ?? ''}`.trim()}
          </Text>
          <View style={styles.failActions}>
            <TextLink variant="small" onPress={() => uploads.retry(item.key)} accessibilityLabel={`Try ${tileName(item, items)} again`}>
              Try again
            </TextLink>
            <TextLink variant="small" onPress={() => uploads.remove(item.key)} accessibilityLabel={`Remove ${tileName(item, items)}`}>
              Remove
            </TextLink>
          </View>
        </View>
      ))}

      <View style={styles.buttons}>
        {Platform.OS !== 'web' ? (
          <Button
            title={canAddVideo ? 'Take photo or video' : 'Take a photo'}
            variant="secondary"
            icon={<Plus size={18} color={colors.ink} />}
            onPress={uploads.takeWithCamera}
            disabled={!canAdd}
            style={styles.button}
            accessibilityLabel={canAddVideo ? 'Take a photo or short video with the camera' : 'Take a photo with the camera'}
          />
        ) : null}
        <Button
          title="Choose from library"
          variant="secondary"
          onPress={uploads.pickFromLibrary}
          disabled={!canAdd}
          style={styles.button}
          accessibilityLabel={canAddVideo ? 'Choose photos or a short video from your library' : 'Choose photos from your library'}
        />
      </View>

      {uploads.notice ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {uploads.notice}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : (
        <Text variant="caption" color="inkFaint">
          {maxVideos > 0
            ? `${photoCount}/${maxPhotos} photos · ${videoCount}/${maxVideos} video (up to ${PRIVATE_VIDEO_MAX_SECONDS} seconds)`
            : `${photoCount}/${maxPhotos} photos`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  row: { gap: space.md, paddingVertical: space.xs, paddingRight: space.sm },
  tileWrap: { width: TILE_WIDTH },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  tileError: { borderWidth: 1, borderColor: colors.danger },
  fill: { width: '100%', height: '100%' },
  videoTile: { alignItems: 'center', justifyContent: 'center', gap: space.xs },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(22,21,19,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
  },
  track: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.white },
  retryLabel: { marginTop: 2 },
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
  failRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  failText: { flexShrink: 1 },
  failActions: { flexDirection: 'row', gap: space.md },
  buttons: { gap: space.sm },
  button: { minHeight: minTouchHeight },
});

export default PrivateMediaPicker;
