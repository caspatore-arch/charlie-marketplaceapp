/**
 * Payouts section of Settings — the seller's side of Stripe Connect.
 *
 * Shows the payout status the server reports (never a guess), and opens the
 * Connect onboarding link in the system browser via `expo-web-browser`.
 *
 * In `simulated` mode — which is where this app is today, because there is no
 * Stripe account — the banner says so, the link is a local placeholder, and
 * the copy states plainly that nothing here connects a real bank account.
 *
 * Direct charges (docs/AUCTIONS.md §3): the seller's own Stripe account takes
 * the payment, so the seller pays the card processing fee and a disputed sale
 * is taken back out of the seller's balance. Both facts are stated here rather
 * than buried — never soften them, and never imply the app protects anyone.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { PaymentsModeBanner } from '@/components/payments/PaymentsModeBanner';
import { trpc } from '@/lib/trpc';
import { formatPrice } from '@/utils/format';
import { colors, space } from '@/constants/theme';

export function PayoutsSection() {
  const utils = trpc.useUtils();
  const router = useRouter();
  const statusQuery = trpc.payment.sellerStatus.useQuery();
  const paymentsQuery = trpc.payment.mine.useQuery();
  const [error, setError] = React.useState<string | null>(null);

  const onboardMutation = trpc.payment.onboardSeller.useMutation({
    onSuccess: async (result) => {
      setError(null);
      try {
        await WebBrowser.openBrowserAsync(result.onboardingUrl);
      } catch {
        setError('That link could not be opened. Try again from a browser.');
      }
      await utils.payment.sellerStatus.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  if (statusQuery.isPending) {
    return (
      <View style={styles.loading}>
        <Skeleton height={64} />
        <Skeleton height={48} />
      </View>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return <ErrorState message={statusQuery.error?.message} onRetry={() => statusQuery.refetch()} />;
  }

  const status = statusQuery.data;
  const started = status.stripeAccountId != null;

  return (
    <View style={styles.wrap}>
      <PaymentsModeBanner
        detail={
          status.simulated
            ? 'Setting this up does not connect a real bank account yet.'
            : undefined
        }
      />

      <View style={styles.statusRow}>
        <Text variant="body">Payouts</Text>
        {status.payoutsEnabled ? (
          <Badge kind="status" label="Ready" tone="success" />
        ) : started ? (
          <Badge kind="status" label="Not finished" tone="warning" />
        ) : (
          <Badge kind="status" label="Not set up" tone="neutral" />
        )}
      </View>

      <Text variant="body" color="inkMuted" style={styles.body}>
        {status.payoutsEnabled
          ? 'Stripe has what it needs to pay you. A buyer pays your Stripe account directly — the app never holds the money. The platform fee and the card processing fee both come out of the sale.'
          : 'To get paid through the app you set up your own Stripe account. A buyer then pays that account directly — the app never holds the money. The platform fee and the card processing fee both come out of the sale.'}
      </Text>

      <Text variant="body" color="inkMuted" style={styles.body}>
        The card processing fee is Stripe&apos;s, currently about 2.9% plus 30¢ on a US card. That
        is an estimate: the exact amount depends on the card and is only known once the payment
        settles, so any figure the app shows you before then is approximate.
      </Text>

      <Text variant="body" color="inkMuted" style={styles.body}>
        {status.payoutDelayDays === 0
          ? 'Stripe pays out to your bank as soon as it can. Because the sale is taken on your own Stripe account, a buyer who disputes a payment has it taken back out of your Stripe balance — and if you have already been paid out, that can leave your balance negative.'
          : `Stripe holds each sale for about ${status.payoutDelayDays} ${
              status.payoutDelayDays === 1 ? 'day' : 'days'
            } before paying it out to your bank. Because the sale is taken on your own Stripe account, a buyer who disputes a payment has it taken back out of your Stripe balance.`}
      </Text>

      {started && !status.payoutsEnabled ? (
        <Text variant="caption" color="inkMuted">
          Details submitted: {status.detailsSubmitted ? 'yes' : 'no'} · Charges enabled:{' '}
          {status.chargesEnabled ? 'yes' : 'no'}
        </Text>
      ) : null}

      <Button
        title={started ? 'Continue payout setup' : 'Set up payouts'}
        variant="secondary"
        loading={onboardMutation.isPending}
        onPress={() => onboardMutation.mutate()}
        style={styles.button}
        accessibilityLabel={started ? 'Continue payout setup' : 'Set up payouts'}
      />

      {error ? (
        <Text variant="caption" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {paymentsQuery.data && paymentsQuery.data.items.length > 0 ? (
        <View style={styles.wrap}>
          <Text variant="heading">Your payments</Text>
          {paymentsQuery.data.items.map((p) => (
            <Button
              key={p.id}
              title={`${p.role === 'buyer' ? 'You paid' : 'Sale'} ${formatPrice(
                p.amountCents,
              )} · ${p.status.replace('_', ' ')}`}
              variant="ghost"
              onPress={() => router.push(`/payments/${p.reservationId}`)}
              style={styles.button}
              accessibilityLabel={`Open payment for ${formatPrice(p.amountCents)}`}
            />
          ))}
        </View>
      ) : null}

      <Text variant="caption" color="inkFaint">
        Refunds are not automatic. Because the money goes to your own account, a refund only
        happens if you agree to it or a moderator steps in — and it comes out of your Stripe
        balance when it does.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  loading: { gap: space.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  body: { lineHeight: 21 },
  button: { alignSelf: 'flex-start' },
  error: { color: colors.danger },
});

export default PayoutsSection;
