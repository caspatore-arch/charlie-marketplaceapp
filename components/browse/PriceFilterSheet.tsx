/**
 * Sheet with min/max dollar inputs for the Browse price filter.
 * Usage: <PriceFilterSheet visible={open} onClose={close} minCents={min} maxCents={max}
 *          onApply={(min, max) => ...} />
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { space } from '@/constants/theme';

export interface PriceFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  minCents?: number;
  maxCents?: number;
  onApply: (minCents?: number, maxCents?: number) => void;
}

function centsToText(cents?: number): string {
  return cents === undefined ? '' : String(Math.round(cents / 100));
}

export function PriceFilterSheet({ visible, onClose, minCents, maxCents, onApply }: PriceFilterSheetProps) {
  const [minText, setMinText] = useState(centsToText(minCents));
  const [maxText, setMaxText] = useState(centsToText(maxCents));
  const [error, setError] = useState<string | undefined>();

  // Re-seed the inputs whenever the sheet opens or the applied range changes
  // while it is open (adjust state during render). Closing clears the key so
  // reopening always re-seeds.
  const syncKey = visible ? `${minCents ?? ''}|${maxCents ?? ''}` : null;
  const [lastSyncKey, setLastSyncKey] = useState<string | null>(syncKey);
  if (lastSyncKey !== syncKey) {
    setLastSyncKey(syncKey);
    if (syncKey !== null) {
      setMinText(centsToText(minCents));
      setMaxText(centsToText(maxCents));
      setError(undefined);
    }
  }

  function apply() {
    const min = minText.trim() ? Math.round(Number(minText) * 100) : undefined;
    const max = maxText.trim() ? Math.round(Number(maxText) * 100) : undefined;
    if ((min !== undefined && Number.isNaN(min)) || (max !== undefined && Number.isNaN(max))) {
      setError('Enter a valid dollar amount.');
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setError('Minimum can’t be more than maximum.');
      return;
    }
    onApply(min, max);
    onClose();
  }

  function clear() {
    onApply(undefined, undefined);
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Price range">
      <View style={styles.row}>
        {/* Input's own wrapper is width: 100%, so each one needs a flex
            wrapper here or the second field is pushed off-screen. */}
        <View style={styles.field}>
          <Input
            label="Min"
            value={minText}
            onChangeText={setMinText}
            keyboardType="number-pad"
            placeholder="$0"
          />
        </View>
        <View style={styles.field}>
          <Input
            label="Max"
            value={maxText}
            onChangeText={setMaxText}
            keyboardType="number-pad"
            placeholder="Any"
          />
        </View>
      </View>
      {error ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button title="Clear" variant="secondary" onPress={clear} style={styles.actionBtn} />
        <Button title="Apply" onPress={apply} style={styles.actionBtn} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  field: { flex: 1, minWidth: 0 },
  error: { marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  actionBtn: { flex: 1 },
});

export default PriceFilterSheet;
