/**
 * Usage: {query.isError && query.data ? <RefetchBanner onRetry={query.refetch} /> : null}
 * Inline banner for a failed refetch over stale data: keep showing the old
 * content and offer a retry, instead of replacing the page with ErrorState.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './Text';
import { Button } from './Button';

export interface RefetchBannerProps {
  message?: string;
  onRetry?: () => void;
}

export function RefetchBanner({
  message = "Couldn't refresh. Showing what we had.",
  onRetry,
}: RefetchBannerProps) {
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Text variant="label" color="inkMuted" style={styles.text}>
        {message}
      </Text>
      {onRetry ? <Button title="Retry" variant="link" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.tint,
  },
  text: { flex: 1, paddingVertical: space.md },
});

export default RefetchBanner;
