/**
 * Trust signals derived only from real recorded behaviour (completed
 * handoffs, account age, active listings, cancellations) — never a
 * user-submitted score, never identity verification. See docs/DESIGN.md
 * "Trust signals" and docs/CONTRACT.md "Trust summary" for the contract
 * this renders.
 *
 * Two exports:
 *   <TrustBlock summary={...} />    full block — profile screen
 *   <TrustCompact summary={...} />  one line, 1-2 figures — listing seller row
 *
 * Both take the exact shape of `trpc.user.trustSummary` output (`TrustSummary`
 * from `@/types`) and both render real zeros rather than hiding the section —
 * a brand-new account is not made to look suspicious, and a heavily-used one
 * is not made to look endorsed. Copy never uses "safe", "trusted", "verified
 * seller", "protected" or "guaranteed" — see docs/DESIGN.md "Rules of copy".
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Calendar, CircleCheck, CircleX, Handshake } from 'lucide-react-native';
import { Text } from './ui/Text';
import { Card } from './ui/Card';
import { colors, space } from '@/constants/theme';
import type { TrustSummary } from '@/types';

/** "Sep 2026" — month/year only, matching the copy rule "Member since Sep 2026". */
function formatMemberSince(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(d);
}

/** One short, honest line explaining what the numbers do and don't mean. */
const FRAMING_COPY =
  'These numbers count meetups actually completed on this app — they are not a safety check or an ID check. Use your own judgment about where and when to meet.';

export interface TrustSignalsProps {
  summary: TrustSummary;
  style?: StyleProp<ViewStyle>;
}

/** Full trust block for the profile screen. */
export function TrustBlock({ summary, style }: TrustSignalsProps) {
  if (summary.isClosed) {
    return (
      <Card style={style}>
        <Text variant="label" weight="600">
          Account history
        </Text>
        <Text variant="body" color="inkMuted" style={styles.closedNote}>
          This account is closed. Its history is no longer shown.
        </Text>
      </Card>
    );
  }

  const memberSince = formatMemberSince(summary.memberSince);
  const hasCancellations = summary.cancelledByUser > 0;

  return (
    <Card style={style}>
      <Text variant="label" weight="600">
        Activity on Campus Swap
      </Text>

      <View style={styles.row}>
        <Handshake size={18} color={colors.inkMuted} />
        <Text variant="body" style={styles.rowText}>
          {summary.completedTotal === 0
            ? 'No handoffs completed yet'
            : `${summary.completedTotal} handoff${summary.completedTotal === 1 ? '' : 's'} completed`}
        </Text>
      </View>
      {summary.completedTotal > 0 ? (
        <Text variant="caption" color="inkFaint" style={styles.subRow}>
          {summary.completedAsSeller} as seller · {summary.completedAsBuyer} as buyer
        </Text>
      ) : null}

      <View style={styles.row}>
        <Calendar size={18} color={colors.inkMuted} />
        <Text variant="body" style={styles.rowText}>
          Member since {memberSince}
        </Text>
      </View>

      <View style={styles.row}>
        <CircleCheck size={18} color={colors.inkMuted} />
        <Text variant="body" style={styles.rowText}>
          {summary.activeListingCount} active listing{summary.activeListingCount === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.row}>
        <CircleX size={18} color={hasCancellations ? colors.warning : colors.inkMuted} />
        <Text variant="body" style={styles.rowText}>
          {summary.cancelledByUser} meetup{summary.cancelledByUser === 1 ? '' : 's'} cancelled
        </Text>
      </View>

      {summary.isDemo ? (
        <Text variant="caption" color="demo" style={styles.demoNote}>
          Demo account — this history is sample data for this pilot, not a real user.
        </Text>
      ) : null}

      <Text variant="caption" color="inkFaint" style={styles.framing}>
        {FRAMING_COPY}
      </Text>
    </Card>
  );
}

/**
 * Compact one-or-two-figure version for the listing detail seller row — the
 * most decision-relevant numbers only: completed handoffs, then account age.
 * Renders nothing extra when there is truly nothing to say beyond zero; the
 * zero itself is still shown per the no-hidden-zeros rule.
 */
export function TrustCompact({ summary }: TrustSignalsProps) {
  if (summary.isClosed) {
    return (
      <Text variant="caption" color="inkFaint">
        Account closed
      </Text>
    );
  }

  const memberSince = formatMemberSince(summary.memberSince);
  const handoffsCopy =
    summary.completedTotal === 0 ? 'No handoffs completed yet' : `${summary.completedTotal} handoffs completed`;

  return (
    <Text variant="caption" color="inkFaint" accessibilityLabel={`${handoffsCopy}. Member since ${memberSince}.`}>
      {handoffsCopy} · Member since {memberSince}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  rowText: { flex: 1 },
  subRow: { marginLeft: 18 + space.sm, marginTop: 2 },
  demoNote: { marginTop: space.md },
  framing: { marginTop: space.md, lineHeight: 16 },
  closedNote: { marginTop: space.sm },
});

export default TrustBlock;
