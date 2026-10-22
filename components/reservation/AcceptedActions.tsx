/**
 * Actions for a booked (accepted) meetup: handoff code show/enter + confirm,
 * reschedule, cancel, and, once the start time has passed, "They didn't show up".
 */
import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import { ActionError } from './ActionError';

export function AcceptedActions({
  isBuyer,
  handoffCode,
  buyerConfirmedAt,
  sellerConfirmedAt,
  confirming,
  error,
  startPassed,
  onConfirmTap,
  onConfirmCode,
  onReschedule,
  onCancel,
  onNoShow,
}: {
  isBuyer: boolean;
  handoffCode: string | null;
  buyerConfirmedAt: Date | null;
  sellerConfirmedAt: Date | null;
  confirming: boolean;
  error: string | null;
  /** True once the agreed start time has passed. */
  startPassed: boolean;
  onConfirmTap: () => void;
  onConfirmCode: (code: string) => void;
  onReschedule: () => void;
  onCancel: () => void;
  onNoShow: () => void;
}) {
  const [codeInput, setCodeInput] = useState('');

  return (
    <View style={styles.actionsGroup}>
      {isBuyer ? (
        <View style={styles.codeBlock}>
          <Text variant="label" color="inkMuted">
            Show this to the seller at pickup
          </Text>
          <Text variant="display" style={styles.codeText}>
            {handoffCode ?? '····'}
          </Text>
          <ActionError message={error} />
          <Button title="Confirm handoff" onPress={onConfirmTap} loading={confirming} disabled={!!buyerConfirmedAt} />
          {buyerConfirmedAt ? <ConfirmedRow label="You confirmed" /> : null}
          <ConfirmedOrWaitingRow confirmed={!!sellerConfirmedAt} label="Seller" />
        </View>
      ) : (
        <View style={styles.codeBlock}>
          <Text variant="label" color="inkMuted">
            Ask the buyer for their 4-digit code
          </Text>
          <TextInput
            value={codeInput}
            onChangeText={(t) => setCodeInput(t.replace(/[^0-9]/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="0000"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Buyer's handoff code"
            style={styles.codeInput}
          />
          <ActionError message={error} />
          <Button
            title="Confirm handoff"
            onPress={() => onConfirmCode(codeInput)}
            loading={confirming}
            disabled={codeInput.length !== 4 || !!sellerConfirmedAt}
          />
          {sellerConfirmedAt ? <ConfirmedRow label="You confirmed" /> : null}
          <ConfirmedOrWaitingRow confirmed={!!buyerConfirmedAt} label="Buyer" />
        </View>
      )}

      {startPassed ? (
        <Button
          title="They didn't show up"
          variant="secondary"
          onPress={onNoShow}
          accessibilityLabel="They didn't show up. Report a no-show."
        />
      ) : null}

      <View style={styles.rescheduleRow}>
        <Button title="Reschedule" variant="secondary" onPress={onReschedule} style={styles.halfBtn} />
        <Button title="Cancel meetup" variant="ghost" onPress={onCancel} style={styles.halfBtn} />
      </View>
    </View>
  );
}

function ConfirmedRow({ label }: { label: string }) {
  return (
    <View style={styles.confirmedRow}>
      <CheckCircle2 size={16} color={colors.success} />
      <Text variant="caption" color="success">
        {label}
      </Text>
    </View>
  );
}

function ConfirmedOrWaitingRow({ confirmed, label }: { confirmed: boolean; label: string }) {
  return (
    <View style={styles.confirmedRow}>
      {confirmed ? <CheckCircle2 size={16} color={colors.success} /> : null}
      <Text variant="caption" color={confirmed ? 'success' : 'inkFaint'}>
        {confirmed ? `${label} confirmed` : `Waiting on ${label.toLowerCase()}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsGroup: { gap: space.sm },
  codeBlock: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
  },
  codeText: { letterSpacing: 8 },
  codeInput: {
    minWidth: 140,
    minHeight: minTouchHeight,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    color: colors.ink,
    paddingHorizontal: space.md,
  },
  confirmedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rescheduleRow: { flexDirection: 'row', gap: space.sm },
  halfBtn: { flex: 1 },
});
