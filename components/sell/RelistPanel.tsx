/**
 * Relist form for an expired or removed listing: the primary action on the
 * edit screen in that state. Prefills the old price and nudges a lower one,
 * then asks for fresh availability (the server needs new 24-hour windows).
 */
import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { WindowEditor, type WindowItem } from '@/components/sell/WindowEditor';
import { DAY_MS } from '@/components/booking/time';
import { formatPrice } from '@/utils/format';
import { Card } from '@/components/ui/Card';
import { colors, radius, space } from '@/constants/theme';

const MIN_CENTS = 100;
const MAX_CENTS = 5_000_00;

/** About 15% lower, whole dollars, never below $1. */
export function suggestedRepostCents(priceCents: number): number {
  return Math.max(MIN_CENTS, Math.round((priceCents * 0.85) / 100) * 100);
}

/** Ask once before reposting at the same or a higher price. */
function confirmSamePrice(price: string, onConfirm: () => void) {
  const title = `Repost at ${price} anyway?`;
  const message = 'Items that didn\'t sell usually need a lower price.';
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Lower the price', style: 'cancel' },
    { text: 'Repost anyway', onPress: onConfirm },
  ]);
}

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
  const [priceInput, setPriceInput] = useState((suggestedRepostCents(priceCents) / 100).toFixed(2));
  const cents = Math.round((Number.parseFloat(sanitize(priceInput)) || 0) * 100);
  const priceError =
    cents < MIN_CENTS ? 'Set an asking price of at least $1.' : cents > MAX_CENTS ? `Asking prices top out at ${formatPrice(MAX_CENTS)}.` : undefined;
  const disabled = windows.length === 0 || !!priceError;

  return (
    <View style={styles.wrap}>
      <Card style={styles.warning}>
        <Text variant="heading">
          This didn&apos;t sell at {formatPrice(priceCents)} in 24 hours. Lower the price before you repost; that&apos;s
          what the market is telling you.
        </Text>
      </Card>
      <Text variant="body" color="inkMuted">
        This listing is {status}. Reposting makes it live for another 24 hours.
      </Text>
      <Input
        label="Asking price ($)"
        value={priceInput}
        onChangeText={(t) => setPriceInput(sanitize(t))}
        keyboardType="decimal-pad"
        maxLength={7}
        error={priceError}
        helper={`Old price ${formatPrice(priceCents)}. We suggested about 15% lower.`}
      />
      <Text variant="label" color="inkMuted">
        When can you meet?
      </Text>
      <WindowEditor windows={windows} onChange={setWindows} until={until} timeZone={timeZone} />
      <Button
        title="Repost"
        size="lg"
        onPress={() => {
          const go = () =>
            onRelist({ priceCents: cents, windows: windows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })) });
          if (cents >= priceCents) confirmSamePrice(formatPrice(cents), go);
          else go();
        }}
        loading={loading}
        disabled={disabled}
      />
      {windows.length === 0 ? (
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          Add at least one time you can meet to repost.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  warning: { backgroundColor: colors.tint, borderRadius: radius.xl },
  hint: { textAlign: 'center' },
});
