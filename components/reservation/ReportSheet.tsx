/** Sheet for reporting the other person after (or instead of) a meetup. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextArea } from '@/components/ui/Input';
import { space } from '@/constants/theme';
import type { ReportReason } from '@/types';
import { ActionError } from './ActionError';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'no_show', label: 'They did not show up' },
  { value: 'scam', label: 'Scam or dishonest listing' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'prohibited_item', label: 'Prohibited item' },
  { value: 'other', label: 'Something else' },
];

export function ReportSheet({
  visible,
  onClose,
  loading,
  error,
  initialReason = 'other',
  title = 'Report a problem',
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  error?: string | null;
  /** Reason selected at first render; the parent remounts (key) to change it. */
  initialReason?: ReportReason;
  title?: string;
  onSubmit: (reason: ReportReason, details: string) => void;
}) {
  const [reason, setReason] = useState<ReportReason>(initialReason);
  const [details, setDetails] = useState('');

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.sheetContent}>
        <View style={styles.reasonChips}>
          {REPORT_REASONS.map((r) => (
            <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
          ))}
        </View>
        <TextArea
          label="Details (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="What happened?"
          style={styles.sheetSectionSpacing}
        />
        <View style={styles.sheetSectionSpacing}>
          <ActionError message={error} />
        </View>
        <Button
          title="Send report"
          variant="danger"
          onPress={() => onSubmit(reason, details)}
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
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
