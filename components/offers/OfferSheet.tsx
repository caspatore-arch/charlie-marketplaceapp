/**
 * Buyer's "Make an offer" sheet. Amount in dollars -> cents; must be at least
 * $1 and below the asking price. Optional note up to 280 characters. Local
 * validation is inline; the server's own message is shown verbatim.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { Input, TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ServerErrorNote, type ServerErrorLike } from './ServerErrorNote';
import { parseDollarsToCents } from '@/components/booking/time';
import { space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';

export const MIN_OFFER_CENTS = 100;
export const MAX_OFFER_NOTE = 280;

export interface OfferSheetProps {
  visible: boolean;
  onClose: () => void;
  askingPriceCents: number;
  submitting: boolean;
  serverError: ServerErrorLike | null;
  onSubmit: (amountCents: number, message?: string) => void;
}

export function validateOfferAmount(text: string, askingPriceCents: number): { cents: number | null; error?: string } {
  if (!text.trim()) return { cents: null, error: 'Enter the amount you want to offer.' };
  const cents = parseDollarsToCents(text);
  if (cents === null) return { cents: null, error: 'Enter a dollar amount like 20 or 20.50.' };
  if (cents < MIN_OFFER_CENTS) return { cents, error: 'Offers start at $1.' };
  if (cents >= askingPriceCents) {
    return {
      cents,
      error: `Offer less than the asking price of ${formatPrice(askingPriceCents)}, or book it at the asking price.`,
    };
  }
  return { cents };
}

export function OfferSheet({ visible, onClose, askingPriceCents, submitting, serverError, onSubmit }: OfferSheetProps) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Reset the form each time the sheet opens (adjust state during render,
  // the React-recommended alternative to an effect).
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) {
      setAmount('');
      setNote('');
      setTouched(false);
      setSubmitted(false);
    }
  }

  const { cents, error } = validateOfferAmount(amount, askingPriceCents);

  function submit() {
    setTouched(true);
    setSubmitted(true);
    if (error || cents === null) return;
    onSubmit(cents, note.trim() || undefined);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Make an offer">
      <View style={styles.body}>
        <Text variant="body" color="inkMuted">
          Asking price is {formatPrice(askingPriceCents)}. If the seller accepts, the item is held for you for one hour
          to book a meetup time. You can send one open offer at a time. No money moves in this prototype.
        </Text>
        <Input
          label="Your offer ($)"
          value={amount}
          onChangeText={setAmount}
          onBlur={() => setTouched(true)}
          placeholder="0.00"
          keyboardType="decimal-pad"
          error={touched && (amount.length > 0 || submitted) ? error : undefined}
          accessibilityHint="Dollars. At least 1 and less than the asking price"
        />
        <TextArea
          label="Note to the seller (optional)"
          value={note}
          onChangeText={(t) => setNote(t.slice(0, MAX_OFFER_NOTE))}
          maxLength={MAX_OFFER_NOTE}
          placeholder="e.g. Can pick up today"
          helper={`${note.length}/${MAX_OFFER_NOTE}`}
        />
        <ServerErrorNote error={serverError} onDismiss={onClose} />
        <Button title="Send offer" onPress={submit} loading={submitting} disabled={touched && (amount.length > 0 || submitted) && !!error} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.lg },
});

export default OfferSheet;
