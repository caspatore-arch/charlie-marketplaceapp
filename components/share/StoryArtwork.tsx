/**
 * Native story artwork: the same picture the web canvas draws (see
 * utils/storyArtwork.ts), built from react-native-svg so it can be exported as
 * a PNG with the Svg ref's `toDataURL`. It is mounted off-screen only while the
 * person is waiting for their image, then thrown away; it is never shown as UI.
 *
 * `size` is in points. Pass 1080 / PixelRatio so the exported PNG comes out at
 * about 1080x1920 pixels whatever the screen density.
 */
import React, { forwardRef } from 'react';
import Svg, { ClipPath, Defs, Image as SvgImage, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '@/constants/theme';
import {
  STORY_HEIGHT,
  STORY_LOGO,
  STORY_WIDTH,
  estimateMeasure,
  fitPriceSize,
  storyLayout,
  storyPriceText,
  wrapTitle,
  type StoryListing,
} from '@/utils/storyArtwork';

interface Props {
  story: StoryListing;
  /** Rendered width in points; height follows the 9:16 ratio. */
  width: number;
  /** Fires when the photo has been drawn, so the caller knows it is safe to export. */
  onPhotoLoad: () => void;
}

export const StoryArtwork = forwardRef<Svg, Props>(function StoryArtwork({ story, width, onPhotoLoad }, ref) {
  const lines = wrapTitle(story.title, estimateMeasure);
  const L = storyLayout(lines.length);
  const price = storyPriceText(story.priceCents);
  const priceSize = fitPriceSize(price, estimateMeasure);

  return (
    <Svg
      ref={ref}
      width={width}
      height={Math.round((width * STORY_HEIGHT) / STORY_WIDTH)}
      viewBox={`0 0 ${STORY_WIDTH} ${STORY_HEIGHT}`}
    >
      <Defs>
        <ClipPath id="storyPhotoClip">
          <Rect x={L.photo.x} y={L.photo.y} width={L.photo.w} height={L.photo.h} rx={L.photo.r} ry={L.photo.r} />
        </ClipPath>
      </Defs>
      <Rect x={0} y={0} width={STORY_WIDTH} height={STORY_HEIGHT} fill={colors.brand} />
      <SvgImage href={STORY_LOGO} x={L.logo.x} y={L.logo.y} width={L.logo.w} height={L.logo.h} />
      <Rect x={L.card.x} y={L.card.y} width={L.card.w} height={L.card.h} rx={L.card.r} ry={L.card.r} fill={colors.surface} />
      {story.photoUrl ? (
        <SvgImage
          href={{ uri: story.photoUrl }}
          x={L.photo.x}
          y={L.photo.y}
          width={L.photo.w}
          height={L.photo.h}
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#storyPhotoClip)"
          onLoad={onPhotoLoad}
        />
      ) : (
        <Rect
          x={L.photo.x}
          y={L.photo.y}
          width={L.photo.w}
          height={L.photo.h}
          rx={L.photo.r}
          ry={L.photo.r}
          fill={colors.surfaceMuted}
        />
      )}
      <SvgText
        x={L.textX}
        y={L.priceBaseline}
        fill={colors.accent}
        fontFamily="Montserrat_700Bold"
        fontSize={priceSize}
      >
        {price}
      </SvgText>
      {lines.map((line, i) => (
        <SvgText
          key={i}
          x={L.textX}
          y={L.titleBaseline + i * L.titleLineHeight}
          fill={colors.ink}
          fontFamily="Montserrat_600SemiBold"
          fontSize={L.titleSize}
        >
          {line}
        </SvgText>
      ))}
    </Svg>
  );
});

export default StoryArtwork;
