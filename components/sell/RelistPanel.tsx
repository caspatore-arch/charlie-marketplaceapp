/**
 * Relist form for an expired or removed listing: the primary action on the
 * edit screen in that state. Prefills the old price and nudges a lower one,
 * then asks for fresh availability (the server needs new 24-hour windows).
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { WindowEditor, type WindowItem } from '@/components/sell/WindowEditor';
import { DAY_MS } from '@/components/booking/time';
import { formatPrice } from '@/utils/format';
import { space } from '@/constants/theme';

const MIN_CENTS = 100;
const MAX_CENTS = 5_000_00;

function sanitize(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
}

export function RelistPanel({
  status,
  priceCents,
  timeZone,
  loading,
  onRelist,
}: {
  status: string;
  priceCents: number;
  timeZone?: string;
  loading: boolean;
  onRelist: (args: { priceCents: number; windows: { startsAt: string; endsAt: string }[] }) => void;
}) {
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [until] = useState(() => new Date(Date.now() + DAY_MS));
  const [priceInput, setPriceInput] = useState((priceCents / 100).toFixed(2));
  const cents = Math.round((Number.parseFloat(sanitize(priceInput)) || 0) * 100);
  const priceError =
    cents < MIN_CENTS ? 'Set an asking price of at least $1.' : cents > MAX_CENTS ? `Asking prices top out at ${formatPrice(MAX_CENTS)}.` : undefined;
  const disabled = windows.length === 0 || !!priceError;

  return (
    <View style={styles.wrap}>
      <Text variant="heading">This listing is {status}</Text>
      <Text variant="body" color="inkMuted">
        Didn&apos;t sell? Repost it at a lower price. Relisting makes it live for another 24 hours.
      </Text>
      <Input
        label="Asking price ($)"
        value={priceInput}
        onChangeText={(t) => setPriceInput(sanitize(t))}
        keyboardType="decimal-pad"
        maxLength={7}
        error={priceError}
        helper={`It was ${formatPrice(priceCents)}. A lower price sells faster.`}
      />
      <Text variant="label" color="inkMuted">
        When can you meet?
      </Text>
      <WindowEditor windows={windows} onChange={setWindows} until={until} timeZone={timeZone} />
      <Button
        title="Relist"
        size="lg"
        onPress={() => onRelist({ priceCents: cents, windows: windows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })) })}
        loading={loading}
        disabled={disabled}
      />
      {windows.length === 0 ? (
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          Add at least one time you can meet to relist.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  hint: { textAlign: 'center' },
});
