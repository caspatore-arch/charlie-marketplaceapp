/**
 * Browse screen filter row: a "Pickup today" toggle chip, category chips (All,
 * then Hottest right beside it, then each category), a price chip (opens
 * PriceFilterSheet from the parent), and a size chip shown only for
 * clothing/shoes categories. When the chips overflow, an arrow button appears
 * on the side(s) with more to scroll to (the scrollbar is hidden, so without
 * it nothing says the row continues).
 * Local to the Browse screen — not a shared ui primitive.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Chip } from '@/components/ui/Chip';
import { colors, radius, shadow, space } from '@/constants/theme';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@/constants/campus';

export type CategoryFilter = Category | 'all';
export type BrowseSort = 'new' | 'hot';

export interface FilterBarProps {
  category: CategoryFilter;
  onCategoryChange: (category: CategoryFilter) => void;
  /** 'new' (default) is strictly newest first; 'hot' ranks by recent likes, comments and shares. */
  sort: BrowseSort;
  onToggleHottest: () => void;
  pickupToday: boolean;
  onTogglePickupToday: () => void;
  priceLabel: string;
  priceActive: boolean;
  onPressPrice: () => void;
  sizeVisible: boolean;
  sizeLabel: string;
  sizeActive: boolean;
  onPressSize: () => void;
}

/** How close to an end still counts as "at the end" (sub-pixel scroll positions). */
const EDGE_SLACK = 4;

export function FilterBar({
  category,
  onCategoryChange,
  sort,
  onToggleHottest,
  pickupToday,
  onTogglePickupToday,
  priceLabel,
  priceActive,
  onPressPrice,
  sizeVisible,
  sizeLabel,
  sizeActive,
  onPressSize,
}: FilterBarProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [m, setM] = useState({ x: 0, content: 0, view: 0 });
  const canScrollLeft = m.x > EDGE_SLACK;
  const canScrollRight = m.content - m.view - m.x > EDGE_SLACK;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setM((prev) => (prev.x === x ? prev : { ...prev, x }));
  }, []);
  const onContentSizeChange = useCallback((content: number) => setM((prev) => ({ ...prev, content })), []);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const view = e.nativeEvent.layout.width;
    setM((prev) => ({ ...prev, view }));
  }, []);
  const scrollBy = (direction: -1 | 1) =>
    scrollRef.current?.scrollTo({ x: Math.max(0, m.x + direction * m.view * 0.7), animated: true });

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
      >
        <Chip label="Pickup today" selected={pickupToday} onPress={onTogglePickupToday} />
        <View style={styles.divider} />
        <Chip label="All" selected={category === 'all'} onPress={() => onCategoryChange('all')} />
        <Chip
          label="Hottest"
          selected={sort === 'hot'}
          onPress={onToggleHottest}
          accessibilityLabel="Hottest. Most liked, shared and commented on recently, first. Tap again for newest first."
        />
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={CATEGORY_LABELS[c]}
            selected={category === c}
            onPress={() => onCategoryChange(c)}
          />
        ))}
        <View style={styles.divider} />
        <Chip label={priceLabel} selected={priceActive} onPress={onPressPrice} />
        {sizeVisible ? <Chip label={sizeLabel} selected={sizeActive} onPress={onPressSize} /> : null}
      </ScrollView>
      {canScrollLeft ? <ScrollArrow side="left" onPress={() => scrollBy(-1)} /> : null}
      {canScrollRight ? <ScrollArrow side="right" onPress={() => scrollBy(1)} /> : null}
    </View>
  );
}

function ScrollArrow({ side, onPress }: { side: 'left' | 'right'; onPress: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={side === 'left' ? 'Scroll filters left' : 'Scroll filters right'}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.arrow, side === 'left' ? styles.arrowLeft : styles.arrowRight, pressed && styles.arrowPressed]}
    >
      <Icon size={20} color={colors.ink} />
    </Pressable>
  );
}

const ARROW = 36;

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.lg },
  divider: { width: 1, height: 20, marginHorizontal: space.xs },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -ARROW / 2,
    width: ARROW,
    height: ARROW,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow,
  },
  arrowLeft: { left: 0 },
  arrowRight: { right: 0 },
  arrowPressed: { opacity: 0.8 },
});

export default FilterBar;
