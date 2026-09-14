/**
 * Browse screen filter row: category chips (All + each category), a
 * "Pickup today" toggle chip, a price chip (opens PriceFilterSheet from the
 * parent), and a size chip shown only for clothing/shoes categories.
 * Local to the Browse screen — not a shared ui primitive.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip } from '@/components/ui/Chip';
import { space } from '@/constants/theme';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@/constants/campus';

export type CategoryFilter = Category | 'all';

export interface FilterBarProps {
  category: CategoryFilter;
  onCategoryChange: (category: CategoryFilter) => void;
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

export function FilterBar({
  category,
  onCategoryChange,
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <Chip label="All" selected={category === 'all'} onPress={() => onCategoryChange('all')} />
      {CATEGORIES.map((c) => (
        <Chip
          key={c}
          label={CATEGORY_LABELS[c]}
          selected={category === c}
          onPress={() => onCategoryChange(c)}
        />
      ))}
      <View style={styles.divider} />
      <Chip label="Pickup today" selected={pickupToday} onPress={onTogglePickupToday} />
      <Chip label={priceLabel} selected={priceActive} onPress={onPressPrice} />
      {sizeVisible ? <Chip label={sizeLabel} selected={sizeActive} onPress={onPressSize} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.lg },
  divider: { width: 1, height: 20, marginHorizontal: space.xs },
});

export default FilterBar;
