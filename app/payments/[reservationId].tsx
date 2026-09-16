/**
 * Payment screen for the buyer who won an auction.
 *
 * Shows the item, the price, the fee breakdown, the 24-hour deadline, and a
 * Pay action. In `simulated` mode (where this app is today — there is no
 * Stripe account) the screen carries the server's banner, and "Pay" creates a
 * payment record against the fake gateway without charging anybody.
 *
 * Fee honesty (direct charges): the buyer's number is exact and the platform's
 * 10% is exact, but the seller now pays Stripe's processing fee out of the
 * sale, and Stripe's exact fee is not known until the payment settles. The
 * seller's figure is therefore shown as an estimate and labelled as one. Never
 * render `sellerNetEstimateCents` without the estimate wording next to it.
 *
 * Copy rules (docs/AUCTIONS.md §3): never "protected", "guaranteed", "safe" or
 * "escrow". The permitted framing is stated plainly — you pay now, the seller
 * is paid right away, and a refund depends on the seller or a moderator.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { PaymentsModeBanner } from '@/components/payments/PaymentsModeBanner';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';

function formatDeadline(at: Date): string {
  return at.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PaymentScreen() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const utils = trpc.useUtils();
  const [error, setError] = React.useState<string | null>(null);

  const paymentQuery = trpc.payment.byReservation.useQuery(
    { reservationId: reservationId! },
    { enabled: authStatus === 'signedIn' && !!reservationId },
  );

  const payMutation = trpc.payment.createIntent.useMutation({
    onSuccess: async () => {
      setError(null);
      await utils.payment.byReservation.invalidate({ reservationId: reservationId! });
    },
    onError: (err) => setError(err.message),
  });

  if (authStatus === 'signedOut') {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Payment' }} />
        <EmptyState
          title="Sign in to see this payment"
          body="Payments are only visible to the buyer and the seller."
          actionLabel="Sign in"
          onAction={() => router.push('/auth/sign-in')}
        />
      </Screen>
    );
  }

  if (paymentQuery.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Payment' }} />
        <View style={styles.loading}>
          <Skeleton height={72} />
          <Skeleton height={160} />
          <Skeleton height={48} />
        </View>
      </Screen>
    );
  }

  if (paymentQuery.isError || !paymentQuery.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Payment' }} />
        <ErrorState
          message={paymentQuery.error?.message}
          onRetry={() => paymentQuery.refetch()}
        />
      </Screen>
    );
  }

  const data = paymentQuery.data;
  const payment = data.payment;
  const isBuyer = data.role === 'buyer';
  const paid = payment?.status === 'paid';
  const refunded = payment?.status === 'refunded';
  const canPay =
    isBuyer && !paid && !refunded && !data.timedOut && data.reservationStatus !== 'cancelled';

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Payment' }} />

      <View style={styles.wrap}>
        <PaymentsModeBanner
          detail={
            data.simulated
              ? 'Tapping Pay records a payment here only. No card is charged and no money reaches the seller.'
              : undefined
          }
        />

        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <Text variant="heading" style={styles.title}>
              {data.listing?.title ?? 'This item'}
            </Text>
            {paid ? <Badge kind="status" label="Paid" tone="success" /> : null}
            {refunded ? <Badge kind="status" label="Refunded" tone="warning" /> : null}
            {data.timedOut ? <Badge kind="status" label="Time ran out" tone="danger" /> : null}
          </View>

          <View style={styles.row}>
            <Text variant="body" color="inkMuted">
              You pay
            </Text>
            <Text variant="body" weight="600">
              {formatPrice(data.amountCents)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text variant="body" color="inkMuted">
              Platform fee ({data.feePercent}%)
            </Text>
            <Text variant="body">{formatPrice(data.feeCents)}</Text>
          </View>
          <View style={styles.row}>
            <Text variant="body" color="inkMuted">
              Card processing fee (estimated)
            </Text>
            <Text variant="body">{formatPrice(data.stripeFeeEstimateCents)}</Text>
          </View>
          <Divider style={styles.divider} />
          <View style={styles.row}>
            <Text variant="heading">Seller receives (estimated)</Text>
            <Text variant="heading">~{formatPrice(data.sellerNetEstimateCents)}</Text>
          </View>
          <Text variant="caption" color="inkFaint">
            {data.estimateNote} The card fee is charged to the seller, so their exact amount is
            only known after the payment settles. Your total is exactly{' '}
            {formatPrice(data.amountCents)}.
          </Text>
        </Card>

        <Text variant="body" color="inkMuted" style={styles.explainer}>
          You pay now; the seller is paid right away. Arrange the handoff in the app. The payment
          goes straight to the seller's own payment account — this app does not hold your money at
          any point.
        </Text>
        <Text variant="body" color="inkMuted" style={styles.explainer}>
          Because the seller is paid immediately, the app cannot take the money back on its own. A
          refund happens only if the seller agrees or a moderator steps in.
        </Text>

        {!paid && !refunded && !data.timedOut ? (
          <Text variant="caption" color="inkFaint">
            Pay by {formatDeadline(data.payDeadline)} or this meetup is cancelled and the seller can
            relist the item.
          </Text>
        ) : null}

        {data.timedOut || data.reservationStatus === 'cancelled' ? (
          <Text variant="body" color="inkMuted">
            {data.cancelReason === 'payment_timeout'
              ? 'The 24-hour window to pay has passed, so this meetup was cancelled and the item went back to the seller.'
              : 'This meetup is closed, so it can no longer be paid for.'}
          </Text>
        ) : null}

        {!isBuyer ? (
          <Text variant="body" color="inkMuted">
            You are the seller here. The buyer pays from their own screen; you will see it marked
            paid once their payment goes through.
          </Text>
        ) : null}

        {canPay ? (
          <Button
            title={payment ? 'Continue payment' : `Pay ${formatPrice(data.amountCents)}`}
            loading={payMutation.isPending}
            onPress={() => payMutation.mutate({ reservationId: reservationId! })}
            size="lg"
            accessibilityLabel={`Pay ${formatPrice(data.amountCents)}`}
          />
        ) : null}

        {error ? (
          <Text variant="caption" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {payment && !paid && !refunded ? (
          <Text variant="caption" color="inkFaint">
            Payment status: {payment.status.replace('_', ' ')}
            {data.simulated
              ? ' — in simulated mode a payment only becomes paid when the local test hook sends the webhook.'
              : ''}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg, paddingBottom: space.huge },
  loading: { gap: space.md, paddingTop: space.xl },
  card: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  title: { flexShrink: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { marginVertical: space.xs },
  explainer: { lineHeight: 21 },
  error: { color: colors.danger },
});
