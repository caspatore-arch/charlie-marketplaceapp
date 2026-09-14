/**
 * List of meetup spots to choose from (request-meetup flow, sell-listing spot
 * multi-select). Usage:
 * <SpotPicker spots={spots} selectedId={spotId} onSelect={setSpotId} />
 * For multi-select (Sell screen), pass `selectedIds` + `onToggle` instead.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { DemoBadge } from './DemoBadge';
import type { MeetupSpot } from '@/types';

export interface SpotPickerProps {
  spots: MeetupSpot[];
  selectedId?: string | null;
  onSelect?: (spotId: string) => void;
  selectedIds?: string[];
  onToggle?: (spotId: string) => void;
}

export function SpotPicker({ spots, selectedId, onSelect, selectedIds, onToggle }: SpotPickerProps) {
  const multi = !!onToggle;

  return (
    <View style={styles.list}>
      {spots.map((spot) => {
        const selected = multi ? !!selectedIds?.includes(spot.id) : selectedId === spot.id;
        return (
          <Pressable
            key={spot.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${spot.name}. ${spot.description}`}
            onPress={() => (multi ? onToggle?.(spot.id) : onSelect?.(spot.id))}
            style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
          >
            <View style={styles.rowInfo}>
              <View style={styles.nameRow}>
                <Text variant="label" weight="600">
                  {spot.name}
                </Text>
                <DemoBadge visible={spot.isDemo} />
              </View>
              <Text variant="caption" color="inkMuted">
                {spot.description}
              </Text>
              {spot.hoursNote ? (
                <Text variant="caption" color="inkFaint">
                  {spot.hoursNote}
                </Text>
              ) : null}
            </View>
            <View style={[styles.radio, selected && styles.radioSelected]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 48,
  },
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.85 },
  rowInfo: { flex: 1, gap: 2, paddingRight: space.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.line,
  },
  radioSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
});

export default SpotPicker;
