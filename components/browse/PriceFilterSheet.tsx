/**
 * Sheet with min/max dollar inputs for the Browse price filter.
 * Usage: <PriceFilterSheet visible={open} onClose={close} minCents={min} maxCents={max}
 *          onApply={(min, max) => ...} />
 */
import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (visible) {
      setMinText(centsToText(minCents));
      setMaxText(centsToText(maxCents));
      setError(undefined);
    }
  }, [visible, minCents, maxCents]);

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
        <Input
          label="Min"
          value={minText}
          onChangeText={setMinText}
          keyboardType="number-pad"
          placeholder="$0"
          style={styles.input}
        />
        <Input
          label="Max"
          value={maxText}
          onChangeText={setMaxText}
          keyboardType="number-pad"
          placeholder="Any"
          style={styles.input}
        />
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
  input: { flex: 1 },
  error: { marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  actionBtn: { flex: 1 },
});

export default PriceFilterSheet;
