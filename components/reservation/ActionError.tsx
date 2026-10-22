/** An action's server error, rendered right next to the buttons that caused it. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';

export function ActionError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text variant="body" color="danger">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
});
