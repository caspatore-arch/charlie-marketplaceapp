/**
 * CONCEPT PROTOTYPE — not live. Fake data, local state only, nothing is sent.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen, Text, Card, Button, Badge } from '@/components/ui';
import { colors, space, radius } from '@/constants/theme';
import { makeFixtures } from './fixtures';
import {
  DEFAULT_BUYOUT_CONFIG, REASON_TEXT, evaluateEligibility, formatCents, formatCountdown,
  sellerAccept, sellerDecline, transition, type BuyoutState,
} from './logic';

const STATE_LABEL: Record<BuyoutState, string> = {
  proposed: 'Proposed',
  seller_accepted: 'Seller accepted',
  seller_declined: 'Seller declined',
  expired: 'Expired',
  manual_review: 'Manual review (a person decides; nothing happens automatically)',
};

export function BuyoutConceptScreen() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const fixtures = useMemo(() => makeFixtures(start), [start]);
  const [states, setStates] = useState<Record<string, BuyoutState>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Concept-only: evaluate with the shipped (disabled) defaults but treat the
  // screen as a demo, so the `enabled` flag is shown rather than enforced here.
  const config = DEFAULT_BUYOUT_CONFIG;

  return (
    <Screen scroll>
      <View style={styles.banner} accessibilityRole="alert">
        <Text variant="heading" color="demo">CONCEPT PROTOTYPE</Text>
        <Text variant="label" color="demo">
          Not live. Fake data. No offers are sent. No payments. Config enabled flag: {String(config.enabled)}.
        </Text>
      </View>
      <Text variant="caption" color="inkMuted" style={styles.gap}>
        Offer = 25% of asking price ($100 listing = $25 offer). Thresholds are unresolved placeholders.
      </Text>

      {fixtures.map((l) => {
        const el = evaluateEligibility(l, config, now);
        const state: BuyoutState | undefined = states[l.id];
        const msLeft = l.expiresAt - now;
        const effective: BuyoutState | undefined =
          state === 'proposed' && msLeft <= 0 ? transition(state, 'expired') : state;
        return (
          <Card key={l.id} style={styles.card}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.flex}>{l.title}</Text>
              <Badge kind="demo" />
            </View>
            <Text variant="label" color="inkMuted">
              Asking {formatCents(l.askingCents)} · {l.category} · {formatCountdown(msLeft)}
            </Text>
            <View style={styles.row}>
              <Badge kind="status" label={el.eligible ? 'Eligible' : 'Not eligible'} tone={el.eligible ? 'success' : 'warning'} />
              {el.eligible ? <Text variant="price">Proposed offer {formatCents(el.offerCents)}</Text> : null}
            </View>
            {el.reasons.map((r) => (
              <Text key={r} variant="caption" color="inkMuted">• {REASON_TEXT[r]}</Text>
            ))}
            {el.eligible && !effective ? (
              <Button title="Propose (local only)" variant="secondary" onPress={() => setStates((s) => ({ ...s, [l.id]: 'proposed' }))} />
            ) : null}
            {effective === 'proposed' ? (
              <View style={styles.row}>
                <Button title="Seller: Accept" onPress={() => setStates((s) => ({ ...s, [l.id]: sellerAccept('proposed') }))} />
                <Button title="Seller: Decline" variant="ghost" onPress={() => setStates((s) => ({ ...s, [l.id]: sellerDecline('proposed') }))} />
              </View>
            ) : null}
            {effective ? <Text variant="label">State: {STATE_LABEL[effective]}</Text> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.demoSoft, borderRadius: radius.md, padding: space.md, marginVertical: space.md, gap: space.xs },
  gap: { marginBottom: space.md },
  card: { marginBottom: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
