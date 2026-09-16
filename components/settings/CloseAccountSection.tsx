/**
 * Destructive "Close account" section. Matches docs/CONTRACT.md's
 * `## Account closure (user.deleteAccount)` exactly: this is anonymization,
 * not erasure, and message history / completed sales are kept. Requires
 * typing DELETE to enable the button, then a confirmAction() confirmation
 * (Alert.alert with buttons silently no-ops on web — see utils/confirm.ts)
 * before firing the mutation. A CONFLICT response (an open accepted meetup)
 * is shown verbatim with a link to Inbox → Requests.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';
import { confirmAction } from '@/utils/confirm';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';

const CONFIRM_WORD = 'DELETE';

export function CloseAccountSection() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [confirmText, setConfirmText] = useState('');
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  const deleteMutation = trpc.user.deleteAccount.useMutation({
    onSuccess: async () => {
      await signOut();
      router.replace('/');
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        setConflictMessage(err.message);
      } else {
        setGenericError(err.message);
      }
    },
  });

  const canDelete = confirmText.trim() === CONFIRM_WORD && !deleteMutation.isPending;

  const onPressClose = () => {
    setConflictMessage(null);
    setGenericError(null);
    confirmAction(
      'Close your account?',
      'Your listings will be removed, open requests cancelled, and you will be signed out everywhere. This cannot be undone.',
      'Close account',
      () => deleteMutation.mutate({ confirmText: CONFIRM_WORD }),
      { cancelLabel: 'Keep my account', destructive: true },
    );
  };

  return (
    <View style={styles.wrap}>
      <Text variant="body" color="inkMuted" style={styles.explainer}>
        Closing your account removes your listings, cancels any pending meetup requests, and signs you out
        everywhere. Your name changes to &quot;Deleted user&quot; in past conversations.
      </Text>
      <Text variant="body" color="inkMuted" style={styles.explainer}>
        This is account closure and anonymization, not full data erasure — your message history and completed
        sales are kept so the other people involved can still see what happened.
      </Text>

      {conflictMessage ? (
        <View style={styles.conflictBox}>
          <Text variant="body" color="danger">
            {conflictMessage}
          </Text>
          <Button
            title="Go to Inbox → Requests"
            variant="secondary"
            onPress={() => router.push('/(tabs)/inbox')}
            style={styles.conflictLink}
          />
        </View>
      ) : null}

      {genericError ? (
        <Text variant="caption" color="danger">
          {genericError}
        </Text>
      ) : null}

      <Input
        label={`Type ${CONFIRM_WORD} to confirm`}
        value={confirmText}
        onChangeText={setConfirmText}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={CONFIRM_WORD}
        accessibilityHint={`Type ${CONFIRM_WORD} to enable the close account button`}
      />

      <Button
        title="Close account"
        variant="danger"
        onPress={onPressClose}
        disabled={!canDelete}
        loading={deleteMutation.isPending}
        accessibilityLabel="Close account"
        style={styles.deleteButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  explainer: { lineHeight: 21 },
  conflictBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  conflictLink: { alignSelf: 'flex-start' },
  deleteButton: { marginTop: space.xs },
});

export default CloseAccountSection;
