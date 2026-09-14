/**
 * Sell-form pickup-spot multi-select. Thin wrapper around the shared
 * `SpotPicker` (multi-select mode) that adds the required-field error text
 * and loading/empty states specific to the Sell form.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SpotPicker } from '@/components/SpotPicker';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { space } from '@/constants/theme';
import type { MeetupSpot } from '@/types';

export interface SpotMultiSelectProps {
  spots: MeetupSpot[] | undefined;
  isLoading: boolean;
  selectedIds: string[];
  onToggle: (spotId: string) => void;
  error?: string;
}

export function SpotMultiSelect({ spots, isLoading, selectedIds, onToggle, error }: SpotMultiSelectProps) {
  if (isLoading) {
    return (
      <View style={styles.skeletonList}>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>
    );
  }

  if (!spots || spots.length === 0) {
    return (
      <Text variant="body" color="inkMuted">
        No meetup spots are set up for your campus yet.
      </Text>
    );
  }

  return (
    <View>
      <SpotPicker spots={spots} selectedIds={selectedIds} onToggle={onToggle} />
      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonList: { gap: space.sm },
  error: { marginTop: space.sm },
});

export default SpotMultiSelect;
