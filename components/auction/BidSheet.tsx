/**
 * Place-a-bid sheet. The minimum is pre-filled, the commitment line is shown
 * before the button, and any server message (BAD_REQUEST / CONFLICT) is
 * displayed verbatim — the server is the authority on what is a legal bid.
 *
 *   <BidSheet visible={open} onClose={...} minimumCents={min} onSubmit={(cents) => ...} />
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';

export interface BidSheetProps {
  visible: boolean;
  onClose: () => void;
  minimumCents: number;
  buyoutPriceCents?: number | null;
  submitting?: boolean;
  /** Server-side message, shown word for word. */
  serverError?: string | null;
  onSubmit: (amountCents: number) => void;
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const dollars = Number.parseFloat(cleaned);
  if (Number.isNaN(dollars)) return null;
  return Math.round(dollars * 100);
}

export function BidSheet({
  visible,
  onClose,
  minimumCents,
  buyoutPriceCents,
  submitting = false,
  serverError,
  onSubmit,
}: BidSheetProps) {
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);

  // Re-prime the field with the current minimum every time the sheet opens —
  // someone else may have outbid the user since they last looked.
  useEffect(() => {
    if (visible) {
      setAmount((minimumCents / 100).toFixed(2).replace(/\.00$/, ''));
      setTouched(false);
    }
  }, [visible, minimumCents]);

  const cents = parseAmount(amount);
  let localError: string | undefined;
  if (cents === null) localError = 'Enter an amount.';
  else if (cents < minimumCents) localError = `The minimum bid is ${formatPrice(minimumCents)}.`;
  else if (buyoutPriceCents != null && cents >= buyoutPriceCents) {
    localError = `That is at or above the buy-it-now price of ${formatPrice(buyoutPriceCents)} — use Buy it now instead.`;
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Place a bid">
      <View style={styles.wrap}>
        <Input
          label="Your bid"
          value={amount}
          onChangeText={setAmount}
          onBlur={() => setTouched(true)}
          keyboardType="decimal-pad"
          placeholder={(minimumCents / 100).toFixed(2)}
          error={touched ? localError : undefined}
          helper={`Minimum ${formatPrice(minimumCents)}`}
        />

        <Text variant="body" color="inkMuted" style={styles.commitment}>
          A bid is a commitment to buy. If you win, you agree to meet the seller and complete the
          handoff. No money moves in this prototype.
        </Text>

        {serverError ? (
          <Text variant="body" color="danger" style={styles.serverError}>
            {serverError}
          </Text>
        ) : null}

        <Button
          title="Place bid"
          onPress={() => {
            setTouched(true);
            if (cents === null || localError) return;
            onSubmit(cents);
          }}
          loading={submitting}
          disabled={submitting}
          accessibilityLabel={`Place a bid of ${amount || formatPrice(minimumCents)}`}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  commitment: { lineHeight: 22 },
  serverError: {},
});

export default BidSheet;
