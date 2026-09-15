/**
 * Bottom sheet for the two moderation actions that take a note:
 * "Remove listing" (note optional, destructive — confirmed before submit)
 * and "Add note" (note is the whole point, submit is disabled until typed).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Input';
import { confirmAction } from '@/utils/confirm';
import { space } from '@/constants/theme';

export interface ModerationActionSheetProps {
  visible: boolean;
  mode: 'remove_listing' | 'note';
  loading: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}

export function ModerationActionSheet({ visible, mode, loading, onClose, onSubmit }: ModerationActionSheetProps) {
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  const isRemove = mode === 'remove_listing';

  return (
    <Sheet visible={visible} onClose={onClose} title={isRemove ? 'Remove listing' : 'Add note'}>
      <View style={styles.content}>
        <Text variant="body" color="inkMuted">
          {isRemove
            ? 'The listing is taken off the market and any active meetup for it is cancelled. This does not affect other listings from this seller.'
            : 'Leave a note on this report for the record. This marks it as reviewed without removing anything.'}
        </Text>
        <TextArea
          label={isRemove ? 'Note (optional)' : 'Note'}
          value={note}
          onChangeText={setNote}
          placeholder={isRemove ? 'Why this listing is being removed' : 'What did you find?'}
          style={styles.textArea}
        />
        <Button
          title={isRemove ? 'Remove listing' : 'Save note'}
          variant={isRemove ? 'danger' : 'primary'}
          onPress={() => {
            if (isRemove) {
              confirmAction(
                'Remove this listing?',
                'It will no longer be visible to buyers, and any active meetup for it will be cancelled.',
                'Remove listing',
                () => onSubmit(note.trim()),
                { cancelLabel: 'Keep it' },
              );
            } else {
              onSubmit(note.trim());
            }
          }}
          disabled={!isRemove && note.trim().length === 0}
          loading={loading}
          style={styles.textArea}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xl, gap: space.xs },
  textArea: { marginTop: space.md },
});

export default ModerationActionSheet;
