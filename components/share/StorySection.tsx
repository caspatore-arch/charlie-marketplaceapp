/**
 * "Share to your story" (optional), shown only in the post-publish modal.
 *
 * Builds a vertical 1080x1920 image of the listing when the person taps, never
 * before. Dibbs cannot post to anyone's Instagram or Snapchat story, so the
 * copy says plainly that they add the image to their own story themselves, and
 * nothing here reports anything as posted. The listing LINK is shared by the
 * ShareRow chips above this section.
 *
 * Web: 2D canvas (utils/storyArtwork.ts) -> PNG blob -> Save (download) or
 * Share (files via the browser share sheet, else Save). iPhone: the same
 * artwork as react-native-svg, exported with toDataURL, written to the cache
 * with expo-file-system and handed to the iOS share sheet (Save Image, Instagram
 * and so on). The iPhone path has not been run (no Xcode on the dev machine).
 */
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type Svg from 'react-native-svg';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { resolveMediaUrl } from '@/lib/trpc';
import { formatPrice } from '@/utils/format';
import {
  STORY_WIDTH,
  StoryArtworkError,
  renderStoryPngWeb,
  saveBlobWeb,
  shareBlobWeb,
  shareFileNative,
  storyFileName,
  writeStoryPngNative,
  type StoryListing,
} from '@/utils/storyArtwork';

// Only loaded (and react-native-svg only pulled in) when an iPhone actually builds the image.
const StoryArtwork = React.lazy(() => import('./StoryArtwork'));

const NATIVE_BUILD_TIMEOUT_MS = 10_000;
const FALLBACK = 'You can still share the link above.';

interface Props {
  listing: { title: string; priceCents: number; coverPhotoUrl: string | null };
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'ready'; previewUri: string; blob: Blob | null; fileUri: string | null }
  | { kind: 'error'; message: string };

export function StorySection({ listing }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [note, setNote] = useState<string | null>(null);
  // Native only: the off-screen artwork is mounted while we wait for it, then dropped.
  const [artboard, setArtboard] = useState(false);
  const [photoReady, setPhotoReady] = useState(false);
  const svgRef = useRef<Svg | null>(null);
  const run = useRef(0); // ignores results from a build the person has since restarted or left
  const blobUrl = useRef<string | null>(null);

  const story: StoryListing = {
    title: listing.title,
    priceCents: listing.priceCents,
    photoUrl: resolveMediaUrl(listing.coverPhotoUrl) ?? null,
  };
  const filename = storyFileName(listing.title);

  useEffect(
    () => () => {
      run.current += 1;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    },
    [],
  );

  const fail = useCallback((id: number, message: string) => {
    if (run.current !== id) return;
    setArtboard(false);
    setPhase({ kind: 'error', message });
  }, []);

  // Native: export once the photo has drawn (or at once when there is none).
  useEffect(() => {
    if (!artboard || !photoReady) return;
    const id = run.current;
    const timer = setTimeout(() => {
      const svg = svgRef.current;
      if (!svg) return fail(id, `Couldn't prepare the image on this device. ${FALLBACK}`);
      svg.toDataURL(async (base64) => {
        if (run.current !== id) return;
        try {
          if (!base64) throw new Error('empty image');
          const uri = await writeStoryPngNative(base64, filename);
          if (run.current !== id) return;
          setArtboard(false);
          setPhase({ kind: 'ready', previewUri: uri, blob: null, fileUri: uri });
        } catch {
          fail(id, `Couldn't prepare the image on this device. ${FALLBACK}`);
        }
      });
    }, 150); // one beat so the last drawn frame is what gets exported
    return () => clearTimeout(timer);
  }, [artboard, photoReady, filename, fail]);

  // Native: give up if the photo never draws.
  useEffect(() => {
    if (!artboard) return;
    const id = run.current;
    const timer = setTimeout(() => fail(id, `Couldn't prepare the image on this device. ${FALLBACK}`), NATIVE_BUILD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [artboard, fail]);

  async function build() {
    const id = ++run.current;
    setNote(null);
    setPhase({ kind: 'building' });
    if (Platform.OS !== 'web') {
      setPhotoReady(!story.photoUrl);
      setArtboard(true);
      return;
    }
    try {
      const blob = await renderStoryPngWeb(story);
      if (run.current !== id) return;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = URL.createObjectURL(blob);
      setPhase({ kind: 'ready', previewUri: blobUrl.current, blob, fileUri: null });
    } catch (err) {
      if (run.current !== id) return;
      const photo = err instanceof StoryArtworkError && err.reason === 'photo';
      fail(
        id,
        photo
          ? `Couldn't load your photo into the image, so it wasn't made. ${FALLBACK}`
          : `Couldn't make the image in this browser. ${FALLBACK}`,
      );
    }
  }

  function save() {
    if (phase.kind !== 'ready' || !phase.blob) return;
    saveBlobWeb(phase.blob, filename);
    setNote('Image saved to your downloads. Add it to your story yourself.');
  }

  async function shareWeb() {
    if (phase.kind !== 'ready' || !phase.blob) return;
    const outcome = await shareBlobWeb(phase.blob, filename, listing.title);
    if (outcome === 'shared') setNote('Image shared. Add it to your story yourself.');
    else if (outcome === 'unsupported') {
      saveBlobWeb(phase.blob, filename);
      setNote("This browser can't share images, so it was saved to your downloads instead.");
    } else if (outcome === 'failed') setNote('Could not open the share sheet. Try Save image.');
    else setNote(null);
  }

  async function shareNative() {
    if (phase.kind !== 'ready' || !phase.fileUri) return;
    const ok = await shareFileNative(phase.fileUri);
    setNote(ok ? null : `Couldn't open the share sheet. ${FALLBACK}`);
  }

  // Android's share sheet cannot take an image file from React Native's Share, so the
  // section is not offered there rather than offering a button that cannot work.
  if (Platform.OS === 'android') return null;

  const ready = phase.kind === 'ready' ? phase : null;
  const live =
    phase.kind === 'building'
      ? 'Making your story image…'
      : phase.kind === 'error'
        ? phase.message
        : (note ?? (ready ? 'Your story image is ready.' : ''));

  return (
    <View style={styles.box}>
      <View style={styles.top}>
        <Thumb preview={ready?.previewUri ?? null} photo={story.photoUrl} price={formatPrice(listing.priceCents)} />
        <View style={styles.topText}>
          <Text variant="heading">Share to your story</Text>
          <Text variant="caption" color="inkMuted">
            Optional
          </Text>
          <Text variant="label" color="inkMuted">
            A ready-made vertical image with your photo, price and title.
          </Text>
        </View>
      </View>
      <Text variant="caption" color="inkMuted">
        Dibbs can&apos;t add it to your Instagram or Snapchat story for you. Save or share the image, then add it to your
        own story yourself.
      </Text>

      {ready ? (
        Platform.OS === 'web' ? (
          <View style={styles.actions}>
            <Button title="Save image" variant="secondary" onPress={save} style={styles.action} />
            <Button title="Share image" variant="secondary" onPress={shareWeb} style={styles.action} />
          </View>
        ) : (
          <Button title="Share or save image" variant="secondary" onPress={shareNative} />
        )
      ) : (
        <Button
          title={phase.kind === 'error' ? 'Try again' : 'Make my story image'}
          variant="secondary"
          loading={phase.kind === 'building'}
          onPress={build}
          accessibilityLabel={phase.kind === 'building' ? 'Making your story image' : undefined}
        />
      )}

      <Text
        variant="caption"
        color={phase.kind === 'error' ? 'danger' : 'inkMuted'}
        accessibilityLiveRegion="polite"
        {...(Platform.OS === 'web' ? ({ role: 'status' } as object) : {})}
      >
        {live}
      </Text>

      {artboard ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.offscreen}
        >
          <Suspense fallback={null}>
            <StoryArtwork
              ref={svgRef}
              story={story}
              // About 1080x1920 output pixels whatever the screen density.
              width={STORY_WIDTH / PixelRatio.get()}
              onPhotoLoad={() => setPhotoReady(true)}
            />
          </Suspense>
        </View>
      ) : null}
    </View>
  );
}

/** Small 9:16 stand-in made of plain views (no canvas, no PNG); swaps to the real image once built. */
function Thumb({ preview, photo, price }: { preview: string | null; photo: string | null; price: string }) {
  return (
    <View style={styles.thumb} accessible={false} importantForAccessibility="no-hide-descendants">
      {preview ? (
        <Image
          source={{ uri: preview }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityLabel="Preview of your story image"
        />
      ) : (
        <View style={styles.thumbCard}>
          <View style={styles.thumbPhoto}>{photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
          <Text variant="caption" weight="700" color="accent" numberOfLines={1}>
            {price}
          </Text>
          <View style={styles.thumbLine} />
        </View>
      )}
    </View>
  );
}

const THUMB_W = 72;

const styles = StyleSheet.create({
  box: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  top: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  topText: { flex: 1, gap: 2 },
  thumb: {
    width: THUMB_W,
    aspectRatio: 9 / 16,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.brand,
  },
  thumbCard: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 28,
    bottom: 14,
    padding: 4,
    gap: 3,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  thumbPhoto: { flex: 1, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  thumbLine: { height: 4, width: '70%', borderRadius: 2, backgroundColor: colors.line },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1, flexBasis: 140 },
  offscreen: { position: 'absolute', left: -4000, top: 0 },
});
