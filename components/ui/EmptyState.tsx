/**
 * Usage: <EmptyState icon={<Search />} title="No listings yet" body="Check back soon."
 *          actionLabel="Browse all" onAction={() => ...} />
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@/constants/theme';
import { Text } from './Text';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" color="inkMuted" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
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
  icon: { marginBottom: space.md },
  title: { textAlign: 'center', marginBottom: space.xs },
  body: { textAlign: 'center' },
  action: { marginTop: space.lg },
});

export default EmptyState;
