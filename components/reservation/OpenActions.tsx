/**
 * Actions for a meetup that is still open (requested/countered). Older flow:
 * booking is instant now, but these states can still exist for older meetups.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { confirmAction } from '@/utils/confirm';
import { space } from '@/constants/theme';
import { ActionError } from './ActionError';

export function OpenActionsForResponder({
  isSeller,
  otherName,
  accepting,
  declining,
  cancelling,
  error,
  onAccept,
  onPropose,
  onDecline,
  onCancel,
}: {
  isSeller: boolean;
  otherName: string;
  accepting: boolean;
  declining: boolean;
  cancelling: boolean;
  error: string | null;
  onAccept: () => void;
  onPropose: () => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.actionsGroup}>
      <Text variant="body" color="inkMuted">
        {otherName} proposed this meetup.
      </Text>
      <ActionError message={error} />
      <Button title="Accept" onPress={onAccept} loading={accepting} />
      <Button title="Propose another time" variant="secondary" onPress={onPropose} />
      {isSeller ? (
        <Button
          title="Decline"
          variant="ghost"
          onPress={() =>
            confirmAction('Decline this request?', 'The buyer will be notified.', 'Decline', onDecline, {
              cancelLabel: 'Keep it',
            })
          }
          loading={declining}
        />
      ) : (
        <Button
          title="Cancel request"
          variant="ghost"
          onPress={() =>
            confirmAction('Cancel this request?', undefined, 'Cancel request', onCancel, {
              cancelLabel: 'Keep it',
            })
          }
          loading={cancelling}
        />
      )}
    </View>
  );
}

export function OpenActionsForProposer({
  otherName,
  cancelling,
  error,
  onChangeProposal,
  onCancel,
}: {
  otherName: string;
  cancelling: boolean;
  error: string | null;
  onChangeProposal: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.actionsGroup}>
      <Text variant="heading">Waiting for {otherName}</Text>
      <Text variant="body" color="inkMuted">
        You proposed this time. We&apos;ll let you know when they respond.
      </Text>
      <ActionError message={error} />
      <Button title="Change proposal" variant="secondary" onPress={onChangeProposal} />
      <Button
        title="Cancel"
        variant="ghost"
        onPress={() =>
          confirmAction('Cancel this request?', undefined, 'Cancel', onCancel, { cancelLabel: 'Keep it' })
        }
        loading={cancelling}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionsGroup: { gap: space.sm },
});
