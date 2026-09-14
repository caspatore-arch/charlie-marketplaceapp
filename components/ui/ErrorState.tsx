/**
 * Usage: <ErrorState message={error.message} onRetry={refetch} />
 * Use for any failed data-driven screen; message should be the human-readable
 * server error when available (tRPC errors already carry these per CONTRACT.md).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@/constants/theme';
import { Text } from './Text';
import { Button } from './Button';

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Something went wrong.', onRetry }: ErrorStateProps) {
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text variant="heading" style={styles.title}>
        Couldn&apos;t load this
      </Text>
      <Text variant="body" color="inkMuted" style={styles.body}>
        {message}
      </Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="secondary" style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.huge,
    paddingHorizontal: space.xl,
  },
  title: { marginBottom: space.xs },
  body: { textAlign: 'center' },
  action: { marginTop: space.lg },
});

export default ErrorState;
