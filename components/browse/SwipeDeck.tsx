/**
 * Tinder-style swipe mode for Browse. Renders the top two cards of `items`;
 * the top card is draggable (pan gesture on the UI thread via reanimated),
 * the next card peeks behind it and grows in as the top card leaves. Right
 * swipe/save calls `onSave`, which may refuse (returns false) — signed-out
 * users get bounced to sign-in by the caller and the card snaps back.
 *
 * The caller remounts the deck (via `key`) when filters or search change, so
 * a new feed always starts from its first card.
 *
 * react-hooks/immutability (a React Compiler lint rule) flags reanimated's
 * `sharedValue.value = …` convention, which is how reanimated is meant to be
 * driven — hence the file-level disable.
 */
/* eslint-disable react-hooks/immutability */
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Clock3, Heart, RotateCcw, X } from 'lucide-react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { PriceText } from '@/components/ui/PriceText';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { resolveMediaUrl } from '@/lib/trpc';
import { conditionLabel, formatPickupWindow } from '@/utils/format';
import type { ListingCard as ListingCardType } from '@/types';

const SWIPE_THRESHOLD_RATIO = 0.3;
const VELOCITY_THRESHOLD = 800;
const MAX_ROTATION_DEG = 12;

export interface SwipeDeckProps {
  items: ListingCardType[];
  onOpen: (id: string) => void;
  /** Returns false when the swipe isn't allowed (e.g. signed out) — the card snaps back. */
  onSave: (item: ListingCardType) => boolean;
  onNearEnd: () => void;
  hasMore: boolean;
  isFetchingMore: boolean;
  onSwitchToGrid: () => void;
}

type Direction = 'left' | 'right';
interface SwipeCardHandle {
  fling: (direction: Direction) => void;
}

// One card's worth of drag/rotation/overlay logic, isolated so the deck only
// ever mounts two of these (perf) and each has its own shared values.
function SwipeCard({
  ref,
  item,
  cardWidth,
  cardHeight,
  isTop,
  dragX,
  onOpen,
  onCommit,
}: {
  ref?: React.Ref<SwipeCardHandle>;
  item: ListingCardType;
  cardWidth: number;
  cardHeight: number;
  isTop: boolean;
  dragX: SharedValue<number>;
  onOpen: () => void;
  onCommit: (direction: Direction) => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const price = item.priceCents;
  const pickup = item.nextPickup;
  const pickupLabel = pickup ? formatPickupWindow(pickup.startsAt, pickup.endsAt) : null;
  const pickupIsToday = item.hasAvailabilityToday;

  const fireHaptic = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const commitOffScreen = useCallback(
    (direction: Direction) => {
      const toX = direction === 'right' ? cardWidth * 1.5 : -cardWidth * 1.5;
      translateX.value = withTiming(toX, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onCommit)(direction);
      });
    },
    [cardWidth, onCommit, translateX],
  );

  // The Pass/Save buttons fling the card exactly as a swipe would, so the
  // two paths can't drift apart in feel or in what they commit.
  useImperativeHandle(
    ref,
    () => ({
      fling: (direction) => {
        fireHaptic();
        dragX.value = withTiming(direction === 'right' ? cardWidth : -cardWidth, { duration: 220 });
        commitOffScreen(direction);
      },
    }),
    [cardWidth, commitOffScreen, dragX, fireHaptic],
  );

  const panGesture = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetX([-12, 12])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY * 0.3;
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      const passedDistance = Math.abs(e.translationX) > cardWidth * SWIPE_THRESHOLD_RATIO;
      const passedVelocity = Math.abs(e.velocityX) > VELOCITY_THRESHOLD;
      if (passedDistance || passedVelocity) {
        const direction = e.translationX > 0 ? 'right' : 'left';
        runOnJS(fireHaptic)();
        commitOffScreen(direction);
      } else {
        translateX.value = withSpring(0, { damping: 18 });
        translateY.value = withSpring(0, { damping: 18 });
        dragX.value = withSpring(0, { damping: 18 });
      }
    });

  const tapGesture = Gesture.Tap()
    .enabled(isTop)
    .maxDistance(10)
    .onEnd(() => {
      runOnJS(onOpen)();
    });

  const composed = Gesture.Exclusive(panGesture, tapGesture);

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-cardWidth, cardWidth],
      [-MAX_ROTATION_DEG, MAX_ROTATION_DEG],
      Extrapolation.CLAMP,
    );
    // Behind card: starts slightly scaled down, grows to full size as the
    // top card is dragged away in either direction.
    const scale = isTop
      ? 1
      : interpolate(Math.abs(dragX.value), [0, cardWidth], [0.95, 1], Extrapolation.CLAMP);
    return {
      transform: [
        { translateX: isTop ? translateX.value : 0 },
        { translateY: isTop ? translateY.value : 0 },
        { rotate: isTop ? `${rotate}deg` : '0deg' },
        { scale },
      ],
    };
  });

  const saveStampStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, cardWidth * 0.15, cardWidth * SWIPE_THRESHOLD_RATIO], [0, 0.3, 1], Extrapolation.CLAMP),
  }));
  const passStampStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-cardWidth * SWIPE_THRESHOLD_RATIO, -cardWidth * 0.15, 0], [1, 0.3, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[
          styles.card,
          { width: cardWidth, height: cardHeight },
          !isTop && styles.cardBehind,
          cardStyle,
        ]}
      >
        <View style={styles.photoWrap}>
          <Image
            source={{ uri: resolveMediaUrl(item.coverPhotoUrl) }}
            style={styles.photo}
            contentFit="cover"
            transition={150}
          />
          {item.seller.isDemo ? (
            <View style={styles.demoBadge}>
              <Badge kind="demo" />
            </View>
          ) : null}
          {isTop ? (
            <>
              <Animated.View style={[styles.stamp, styles.stampSave, saveStampStyle]}>
                <Heart size={18} color={colors.success} fill={colors.success} />
                <Text variant="heading" weight="700" color="success">
                  SAVE
                </Text>
              </Animated.View>
              <Animated.View style={[styles.stamp, styles.stampPass, passStampStyle]}>
                <X size={18} color={colors.danger} strokeWidth={3} />
                <Text variant="heading" weight="700" color="danger">
                  PASS
                </Text>
              </Animated.View>
            </>
          ) : null}
        </View>

        <View style={styles.info}>
          <PriceText cents={price} />
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {item.title}
          </Text>
          <Text variant="caption" color="inkMuted" numberOfLines={1}>
            {conditionLabel(item.condition)}
            {item.size ? ` · ${item.size}` : ''}
          </Text>
          <View style={styles.pickupRow}>
            <Clock3 size={12} color={pickupIsToday ? colors.accent : colors.inkFaint} strokeWidth={2.5} />
            <Text
              variant="caption"
              weight={pickupIsToday ? '600' : '500'}
              color={pickupIsToday ? 'accent' : 'inkFaint'}
              numberOfLines={1}
              style={styles.pickupText}
            >
              {pickupLabel ?? 'Ask for a time'}
            </Text>
          </View>
          <View style={styles.sellerRow}>
            <Avatar uri={item.seller.avatarUrl} name={item.seller.displayName} size={20} />
            <Text variant="caption" color="inkFaint" numberOfLines={1} style={styles.sellerName}>
              {item.seller.displayName}
            </Text>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export function SwipeDeck({
  items,
  onOpen,
  onSave,
  onNearEnd,
  hasMore,
  isFetchingMore,
  onSwitchToGrid,
}: SwipeDeckProps) {
  const [index, setIndex] = useState(0);
  // The item that just left the deck, kept around so Undo can restore it.
  const [lastRemoved, setLastRemoved] = useState<{ item: ListingCardType; atIndex: number } | null>(null);
  // Bumped when a save is refused. The top card has already flown off by
  // then, so it is remounted under a new key to bring it back to centre.
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const dragX = useSharedValue(0);
  const topCardRef = useRef<SwipeCardHandle>(null);

  useEffect(() => {
    const remaining = items.length - index;
    if (remaining <= 5 && hasMore) onNearEnd();
  }, [index, items.length, hasMore, onNearEnd]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  }, []);

  const advance = useCallback(
    (item: ListingCardType, direction: Direction) => {
      if (direction === 'right' && !onSave(item)) {
        // Not allowed (signed out) — bring the card back rather than advancing.
        dragX.value = 0;
        setRestoreNonce((n) => n + 1);
        return;
      }
      setLastRemoved({ item, atIndex: index });
      setIndex((i) => i + 1);
      dragX.value = 0;
    },
    [index, onSave, dragX],
  );

  const handleUndo = useCallback(() => {
    if (!lastRemoved) return;
    setIndex(lastRemoved.atIndex);
    setLastRemoved(null);
    dragX.value = 0;
  }, [lastRemoved, dragX]);

  const cardWidth = containerSize.width - space.lg * 2;
  const cardHeight = containerSize.height - space.md * 2;

  const visible = items.slice(index, index + 2);
  const topItem = visible[0];
  const nextItem = visible[1];
  const atEnd = index >= items.length && !hasMore;

  return (
    <View style={styles.wrap}>
      <View style={styles.deckArea} onLayout={onLayout}>
        {containerSize.width === 0 ? null : atEnd ? (
          <EmptyState
            title="You're all caught up"
            body="No more listings match these filters right now."
            actionLabel="Back to grid"
            onAction={onSwitchToGrid}
          />
        ) : !topItem ? (
          <View style={styles.endLoading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            {nextItem ? (
              <SwipeCard
                key={nextItem.id}
                item={nextItem}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                isTop={false}
                dragX={dragX}
                onOpen={() => {}}
                onCommit={() => {}}
              />
            ) : null}
            <SwipeCard
              key={`${topItem.id}:${restoreNonce}`}
              ref={topCardRef}
              item={topItem}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              isTop
              dragX={dragX}
              onOpen={() => onOpen(topItem.id)}
              onCommit={(direction) => advance(topItem, direction)}
            />
          </>
        )}
      </View>

      {!atEnd && topItem ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo last swipe"
            disabled={!lastRemoved}
            onPress={handleUndo}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnSmall,
              !lastRemoved && styles.actionBtnDisabled,
              pressed && lastRemoved && styles.actionBtnPressed,
            ]}
          >
            <RotateCcw size={20} color={colors.inkMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pass"
            onPress={() => topCardRef.current?.fling('left')}
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnLarge, pressed && styles.actionBtnPressed]}
          >
            <X size={26} color={colors.danger} strokeWidth={2.5} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            onPress={() => topCardRef.current?.fling('right')}
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnLarge, pressed && styles.actionBtnPressed]}
          >
            <Heart size={26} color={colors.success} />
          </Pressable>
        </View>
      ) : null}

      {isFetchingMore && !atEnd ? (
        <View style={styles.fetchingMore}>
          <ActivityIndicator color={colors.accent} size="small" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  deckArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  endLoading: { alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...({
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    } as object),
  },
  cardBehind: { zIndex: -1 },
  photoWrap: { flex: 1, backgroundColor: colors.surfaceMuted },
  photo: { width: '100%', height: '100%' },
  demoBadge: { position: 'absolute', top: space.sm, right: space.sm },
  stamp: {
    position: 'absolute',
    top: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 3,
    backgroundColor: colors.surface,
  },
  // Each stamp sits on the edge that trails the swipe — the leading edge is
  // the one sliding off screen, so a stamp there would never be seen.
  stampSave: { left: space.lg, borderColor: colors.success, transform: [{ rotate: '-12deg' }] },
  stampPass: { right: space.lg, borderColor: colors.danger, transform: [{ rotate: '12deg' }] },
  info: { padding: space.lg, gap: 2 },
  title: { color: colors.ink },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  pickupText: { flexShrink: 1 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 4 },
  sellerName: { flexShrink: 1 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    paddingVertical: space.lg,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  actionBtnSmall: { width: 44, height: 44 },
  actionBtnLarge: { width: 60, height: 60 },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnPressed: { opacity: 0.8 },
  fetchingMore: { position: 'absolute', bottom: space.huge, alignSelf: 'center' },
});

export default SwipeDeck;
