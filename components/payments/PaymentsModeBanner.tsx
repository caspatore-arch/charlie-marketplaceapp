/**
 * The banner every payment surface carries while the server is in `simulated`
 * mode: **"Simulated — no money moves."**
 *
 * The text and the decision to show it both come from the server
 * (`payment.config` → `banner`, derived from PAYMENTS_MODE + whether a Stripe
 * key exists). Nothing here is hard-coded optimistically: if the server ever
 * reports `test` or `live`, this renders that instead, and it renders a
 * cautious placeholder while the mode is still loading rather than nothing.
 *
 * Copy rule (docs/AUCTIONS.md §3, docs/DESIGN.md): never "protected",
 * "guaranteed", "safe" or "escrow".
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { trpc } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';

export interface PaymentsModeBannerProps {
  /** Extra line under the banner, e.g. what this particular screen does. */
  detail?: string;
}

export function PaymentsModeBanner({ detail }: PaymentsModeBannerProps) {
  const configQuery = trpc.payment.config.useQuery(undefined, { staleTime: 60_000 });
  const config = configQuery.data;

  // Unknown mode = assume nothing works. Never show an encouraging default.
  const headline = config
    ? config.simulated
      ? config.banner
      : `Payments are in ${config.mode} mode.`
    : 'Checking payment mode…';

  const tone = !config || config.simulated ? 'simulated' : 'liveish';

  return (
    <View
      style={[styles.wrap, tone === 'simulated' ? styles.simulated : styles.liveish]}
      accessibilityRole="alert"
      accessibilityLabel={headline}
    >
      <Text variant="label" weight="600" style={tone === 'simulated' ? styles.simText : styles.liveText}>
        {headline}
      </Text>
      {detail ? (
        <Text variant="caption" style={tone === 'simulated' ? styles.simText : styles.liveText}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.xs,
    borderWidth: 1,
  },
  simulated: { backgroundColor: colors.demoSoft, borderColor: colors.demo },
  liveish: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  simText: { color: colors.demo },
  liveText: { color: colors.warning },
});

export default PaymentsModeBanner;
