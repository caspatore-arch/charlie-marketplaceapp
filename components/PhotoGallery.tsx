/**
 * Horizontal paging photo gallery with dot indicators. Usage:
 * <PhotoGallery photos={listingDetail.photos} />
 */
import React, { useState } from 'react';
import { Dimensions, FlatList, StyleSheet, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { Image } from 'expo-image';
import { colors, space } from '@/constants/theme';
import { resolveMediaUrl } from '@/lib/trpc';

export interface GalleryPhoto {
  id: string;
  url: string;
}

export interface PhotoGalleryProps {
  photos: GalleryPhoto[];
  aspectRatio?: number;
}

const { width: screenWidth } = Dimensions.get('window');

export function PhotoGallery({ photos, aspectRatio = 4 / 5 }: PhotoGalleryProps) {
  const [index, setIndex] = useState(0);
  const height = screenWidth / aspectRatio;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    if (newIndex !== index) setIndex(newIndex);
  }

  if (photos.length === 0) {
    return <View style={[styles.placeholder, { height }]} />;
  }

  return (
    <View>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <Image
            accessibilityLabel="Listing photo"
            source={{ uri: resolveMediaUrl(item.url) }}
            style={{ width: screenWidth, height }}
            contentFit="cover"
            transition={150}
          />
        )}
      />
      {photos.length > 1 ? (
        <View style={styles.dots}>
          {photos.map((p, i) => (
            <View key={p.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { width: '100%', backgroundColor: colors.surfaceMuted },
  dots: {
    position: 'absolute',
    bottom: space.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  dotActive: { backgroundColor: colors.white, width: 8, height: 8, borderRadius: 4 },
});

export default PhotoGallery;
