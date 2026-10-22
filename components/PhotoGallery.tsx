/**
 * Horizontal paging photo gallery with dot indicators. Usage:
 * <PhotoGallery photos={listingDetail.photos} />
 */
import React, { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, space } from '@/constants/theme';
import { resolveMediaUrl } from '@/lib/trpc';

export interface GalleryPhoto {
  id: string;
  url: string;
}

export interface PhotoGalleryProps {
  photos: GalleryPhoto[];
  aspectRatio?: number;
}

/**
 * Hard ceiling on the photo's height.
 *
 * Without it the gallery grows with its container: at a 4:5 ratio an 860px
 * content column produces a 1075px-tall photo, which pushed the price, the
 * condition, the seller and both buttons off the bottom of the screen. A photo
 * should not cost you the rest of the page.
 */
const MAX_PHOTO_HEIGHT = 560;
/** …and never more than this share of the viewport, on short windows. */
const MAX_VIEWPORT_SHARE = 0.6;

export function PhotoGallery({ photos, aspectRatio = 4 / 5 }: PhotoGalleryProps) {
  const list = useRef<FlatList<GalleryPhoto>>(null);
  const [index, setIndex] = useState(0);

  // Measure the CONTAINER, not the window. The old code paged on
  // useWindowDimensions().width, which is the whole browser window — but on
  // desktop the content column is capped (maxContentWidth), so every page was
  // wider than the box holding it: the image overflowed and paging landed
  // between photos. The container is the only width that is actually true here.
  const [containerWidth, setContainerWidth] = useState(0);
  const { height: windowHeight } = useWindowDimensions();

  function onLayout(e: LayoutChangeEvent) {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== containerWidth) setContainerWidth(w);
  }

  const height = Math.min(
    containerWidth / aspectRatio,
    MAX_PHOTO_HEIGHT,
    Math.max(240, windowHeight * MAX_VIEWPORT_SHARE),
  );

  // Once the height is capped, a full-width page would mat a 4:5 photo with
  // wide bars on both sides. Narrow the page to the ratio instead and centre
  // it, so a photo shaped like the frame fills the frame. A photo of some
  // other shape still gets a mat, which is correct — we do not know its
  // intrinsic ratio, and cropping it is what we are trying to stop doing.
  const pageWidth = Math.min(containerWidth, Math.round(height * aspectRatio));

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (pageWidth <= 0) return;
    const newIndex = Math.max(0, Math.min(photos.length - 1, Math.round(e.nativeEvent.contentOffset.x / pageWidth)));
    if (newIndex !== index) setIndex(newIndex);
  }

  // Until the first layout pass the width is unknown. Render the placeholder
  // box rather than zero-width pages, which would otherwise flash and leave
  // the FlatList's paging offsets wrong for the first frame.
  if (photos.length === 0 || containerWidth <= 0) {
    return (
      <View
        onLayout={onLayout}
        style={[styles.placeholder, { height: containerWidth > 0 ? height : undefined }]}
      />
    );
  }

  return (
    <View onLayout={onLayout}>
      <FlatList
        ref={list}
        key={pageWidth}
        initialScrollIndex={Math.min(index, photos.length - 1)}
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Paging is width-based, so the list must be told the exact page width
        // it is scrolling by — otherwise a resize leaves it between photos.
        getItemLayout={(_, i) => ({
          length: pageWidth,
          offset: pageWidth * i,
          index: i,
        })}
        style={{ width: pageWidth, alignSelf: 'center' }}
        renderItem={({ item }) => (
          <View style={{ width: pageWidth, height }}>
            <Image
              accessibilityLabel="Listing photo"
              source={{ uri: resolveMediaUrl(item.url) }}
              style={styles.photo}
              // `contain`, not `cover`. This is the screen where someone
              // decides whether to buy the thing, so they get to see all of
              // it — a cover crop silently sliced the sides off any photo that
              // was not already 4:5, which is most photos off a phone. The
              // grid card still uses cover, because a grid needs one shape.
              contentFit="contain"
              transition={150}
            />
          </View>
        )}
      />
      {photos.length > 1 ? (
        <View style={styles.dots} pointerEvents="box-none">
          <View style={styles.dotsPill}>
            {photos.map((p, i) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`Show photo ${i + 1} of ${photos.length}`}
                accessibilityState={{ selected: i === index }}
                hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
                onPress={() => {
                  list.current?.scrollToOffset({ offset: i * pageWidth, animated: false });
                  setIndex(i);
                }}
                style={[styles.dot, i === index && styles.dotActive]}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    width: '100%',
    minHeight: 240,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  // The muted ground is what the letterbox bars show as when a photo is not
  // 4:5. It reads as a deliberate mat around the photo rather than a gap.
  photo: { width: '100%', height: '100%', backgroundColor: colors.surfaceMuted },
  // Small dots sit over the bottom of the photo; the image keeps its space.
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.sm,
    alignItems: 'center',
  },
  dotsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotActive: { backgroundColor: colors.white, width: 9, height: 9, borderRadius: 5 },
});

export default PhotoGallery;
