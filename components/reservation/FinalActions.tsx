/** Status blocks for finished meetups: completed (with report) and closed (declined/cancelled/expired). */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { colors, minTouchHeight, space } from '@/constants/theme';

export function CompletedActions({ onReport }: { onReport: () => void }) {
  return (
    <View style={styles.actionsGroup}>
      <View style={styles.successRow}>
        <CheckCircle2 size={20} color={colors.success} />
        <Text variant="heading">Handed off — item marked sold</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onReport} style={styles.reportLink}>
        <Text variant="label" color="inkMuted" style={styles.reportLinkText}>
          Report a problem
        </Text>
      </Pressable>
    </View>
  );
}

export function ClosedActions({
  status,
  reason,
}: {
  status: 'declined' | 'cancelled' | 'expired';
  reason: string | null;
}) {
  const copy: Record<typeof status, string> = {
    declined: 'The seller declined this request.',
    cancelled: 'This meetup was cancelled.',
    expired: 'This meetup request expired.',
  };

  return (
    <View style={styles.actionsGroup}>
      <Text variant="body" color="inkMuted">
        {copy[status]}
      </Text>
      {reason ? (
        <Text variant="caption" color="inkFaint" style={styles.reasonText}>
          Reason: {reason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionsGroup: { gap: space.sm },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reportLink: { minHeight: minTouchHeight, justifyContent: 'center' },
  reportLinkText: { textDecorationLine: 'underline' },
  reasonText: { marginTop: -space.xs },
});
