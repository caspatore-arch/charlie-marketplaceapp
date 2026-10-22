/** Sheet for cancelling a booked meetup, with an optional reason. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Input';
import { space } from '@/constants/theme';
import { ActionError } from './ActionError';

export function CancelSheet({
  visible,
  onClose,
  onConfirm,
  loading,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  loading: boolean;
  error?: string | null;
}) {
  const [reason, setReason] = useState('');

  return (
    <Sheet visible={visible} onClose={onClose} title="Cancel this meetup?">
      <View style={styles.sheetContent}>
        <Text variant="body" color="inkMuted">
          The other person will be notified. The item goes back on the market.
        </Text>
        <TextArea
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
          placeholder="Let them know why"
          style={styles.sheetSectionSpacing}
        />
        <View style={styles.sheetSectionSpacing}>
          <ActionError message={error} />
        </View>
        <Button
          title="Cancel meetup"
          variant="danger"
          onPress={() => onConfirm(reason)}
          loading={loading}
          style={styles.sheetSectionSpacing}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheetContent: { paddingBottom: space.xl, gap: space.xs },
  sheetSectionSpacing: { marginTop: space.md },
});
