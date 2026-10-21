/** Reason picker for reporting a community post. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { space } from '@/constants/theme';
import type { ReportReason } from '@/types';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'prohibited_item', label: 'Prohibited item' },
  { value: 'scam', label: 'Scam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'other', label: 'Other' },
];

export interface PostReportSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ReportReason, details?: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function PostReportSheet({ visible, onClose, onSubmit, loading = false, error }: PostReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | undefined>();
  const [details, setDetails] = useState('');

  return (
    <Sheet visible={visible} onClose={onClose} title="Report this post">
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
        maxLength={1000}
        style={styles.details}
      />
      {error ? (
        <Text variant="caption" color="danger" style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        title="Submit report"
        onPress={() => reason && onSubmit(reason, details.trim() || undefined)}
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
  error: { marginTop: space.sm },
  submit: { marginTop: space.lg },
});

export default PostReportSheet;
