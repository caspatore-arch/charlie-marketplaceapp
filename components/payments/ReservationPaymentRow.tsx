/**
 * Payment state for one meetup, shown on the reservation screen.
 *
 * This is the buyer's only route into the payment screen; before it existed the
 * only way in was Settings -> Payouts, which nobody would ever find.
 *
 * Copy rules (docs/DESIGN.md): never say protected, guaranteed, safe or escrow,
 * and never let a simulated payment read as a real one. When there is no
 * payment path at all we say so plainly rather than showing a dead button.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { trpc } from '@/lib/trpc';
import { usePaymentsEnabled } from '@/hooks/usePaymentsEnabled';
import { formatPrice } from '@/utils/format';
import { colors, radius, space } from '@/constants/theme';

export interface ReservationPaymentRowProps {
  reservationId: string;
  /** Only an active meetup can be paid for; cancelled ones must not offer it. */
  enabled: boolean;
}

export function ReservationPaymentRow({ reservationId, enabled }: ReservationPaymentRowProps) {
  const router = useRouter();
  const paymentsEnabled = usePaymentsEnabled();
  const query = trpc.payment.byReservation.useQuery({ reservationId }, { enabled: enabled && paymentsEnabled });

  // Payments are off: there is nothing to show. While it loads, say nothing
  // rather than flashing a wrong state.
  if (!paymentsEnabled || !enabled || !query.data) return null;

  const d = query.data;
  const status = d.payment?.status ?? null;
  const isBuyer = d.role === 'buyer';
  const paid = status === 'paid';
  const refunded = status === 'refunded';

  // Nobody can pay until the seller can actually receive money.
  const payable = d.sellerPayoutsEnabled && !paid && !refunded && !d.timedOut;

  let line: string;
  if (refunded) line = 'This payment was refunded.';
  else if (paid) line = `Paid ${formatPrice(d.payment?.amountCents ?? 0)}. The app does not hold this money.`;
  else if (d.timedOut) line = 'The payment window closed, so this meetup was cancelled.';
  else if (!d.sellerPayoutsEnabled)
    line = isBuyer
      ? 'The seller has not set up payouts, so you cannot pay in the app. Arrange payment in person.'
      : 'Set up payouts in Settings if you want to be paid through the app.';
  else if (isBuyer) line = 'You pay before you receive the item. The app does not hold the money.';
  else line = 'Waiting for the buyer to pay.';

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="label" weight="600">
          Payment
        </Text>
        <View style={styles.badge}>
          <Text variant="caption" weight="600" color="demo">
            {d.banner}
          </Text>
        </View>
      </View>

      <Text variant="caption" color="inkMuted">
        {line}
      </Text>

      {payable && isBuyer ? (
        <Button
          title={`Pay ${formatPrice(d.amountCents)}`}
          onPress={() => router.push(`/payments/${reservationId}`)}
          accessibilityLabel={`Pay ${formatPrice(d.amountCents)} for this meetup`}
          style={styles.action}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  badge: {
    backgroundColor: colors.demoSoft,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  action: { marginTop: space.xs },
});

export default ReservationPaymentRow;
