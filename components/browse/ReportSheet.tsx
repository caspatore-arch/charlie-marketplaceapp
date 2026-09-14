/**
 * Reason-picker sheet used by the item detail screen's Report action.
 * Usage: <ReportSheet visible={open} onClose={close} onSubmit={(reason, details) => ...} loading={pending} />
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { space } from '@/constants/theme';
import type { ReportReason } from '@/types';

export interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ReportReason, details?: string) => void;
  loading?: boolean;
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'prohibited_item', label: 'Prohibited item' },
  { value: 'scam', label: 'Scam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'no_show', label: 'No-show' },
  { value: 'other', label: 'Other' },
];

export function ReportSheet({ visible, onClose, onSubmit, loading = false }: ReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | undefined>();
  const [details, setDetails] = useState('');

  function submit() {
    if (!reason) return;
    onSubmit(reason, details.trim() || undefined);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Report this listing">
      <View style={styles.grid}>
        {REASONS.map((r) => (
          <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
        ))}
      </View>
      <TextArea
        label="Details (optional)"
        value={details}
        onChangeText={setDetails}
        placeholder="Anything else we should know?"
        style={styles.details}
      />
      <Button
        title="Submit report"
        onPress={submit}
        disabled={!reason}
        loading={loading}
        style={styles.submit}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  details: { marginTop: space.lg },
  submit: { marginTop: space.lg },
});

export default ReportSheet;
