/**
 * Sheet with a chip grid of size options for the Browse size filter (only
 * shown when the active category is clothing or shoes). Usage:
 * <SizeFilterSheet visible={open} onClose={close} options={CLOTHING_SIZE_OPTIONS}
 *   selected={size} onSelect={setSize} />
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { space } from '@/constants/theme';

export interface SizeFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  options: string[];
  selected?: string;
  onSelect: (size?: string) => void;
}

export function SizeFilterSheet({ visible, onClose, options, selected, onSelect }: SizeFilterSheetProps) {
  function choose(size?: string) {
    onSelect(size);
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Size">
      <View style={styles.grid}>
        <Chip label="Any" selected={!selected} onPress={() => choose(undefined)} />
        {options.map((size) => (
          <Chip key={size} label={size} selected={selected === size} onPress={() => choose(size)} />
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.md },
});

export default SizeFilterSheet;
