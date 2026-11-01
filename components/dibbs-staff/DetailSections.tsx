/**
 * Read-only sections of the request detail. Estimate, meetup, final offer,
 * accepted price, handoff and payout are SEPARATE labelled facts: an estimate
 * is not an agreed price, and a handoff is not a payment.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, radius, space } from '@/constants/theme';
import { exactMeetupTime, zoneAbbreviation } from '@/components/booking/time';
import {
  CONDITION_LABEL,
  STATUS_LABEL,
  estimateText,
  formatCents,
  formatWhen,
  isOpenStatus,
  outcomeLabel,
  statusTone,
  waitingText,
  type StaffDetail,
} from './format';

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.card}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </Card>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ''}`}>
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
      <Text variant="body" weight="600">
        {value}
      </Text>
      {note ? (
        <Text variant="caption" color="inkMuted">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export function HeaderBlock({ d }: { d: StaffDetail }) {
  const open = isOpenStatus(d.status);
  const status = d.status === 'meetup_proposed'
    ? d.meetup?.proposedBy === 'seller'
      ? 'Meetup proposed by the seller'
      : 'Meetup proposed by Dibbs, waiting for the seller'
    : STATUS_LABEL[d.status];
  return (
    <View style={styles.header}>
      <Text variant="caption" color="inkMuted">
        Dibbs buying team · Private request
      </Text>
      <Text variant="displaySm" accessibilityRole="header">
        {d.itemName}
      </Text>
      <View style={styles.badges}>
        <Badge kind="status" label={status} tone={statusTone(d.status)} />
        {d.staffActionNeeded ? <Badge kind="status" label="Needs action" tone="warning" /> : null}
        {d.listing ? <Badge kind="status" label="Public listing" tone="neutral" /> : null}
      </View>
      <Text variant="label" color="inkMuted">
        {`Submitted ${formatWhen(d.createdAt)}${open ? ` · waiting ${waitingText(d.waitingMinutes)}` : ` · last updated ${formatWhen(d.updatedAt)}`}`}
      </Text>
      <Text variant="label" color="inkMuted">
        {d.assignedStaff ? `Reviewing: ${d.assignedStaff.displayName}` : 'Nobody is reviewing this yet'}
      </Text>
    </View>
  );
}

export function ItemSection({ d }: { d: StaffDetail }) {
  return (
    <SectionCard title="Item">
      <Fact label="Name" value={d.itemName} />
      <Fact label="Condition (as the seller described it)" value={d.condition ? (CONDITION_LABEL[d.condition] ?? d.condition) : 'Not given'} />
      {d.specs ? <Fact label="Specs" value={d.specs} /> : null}
      {d.description ? (
        <View style={styles.fact}>
          <Text variant="caption" color="inkMuted">
            Description
          </Text>
          <Text variant="body">{d.description}</Text>
        </View>
      ) : null}
      {!d.specs && !d.description ? (
        <Text variant="bodySm" color="inkMuted">
          The seller didn’t add specs or a description.
        </Text>
      ) : null}
    </SectionCard>
  );
}

export function SellerSection({ d }: { d: StaffDetail }) {
  const s = d.seller;
  return (
    <SectionCard title="Seller">
      <Text variant="body" weight="600">
        {s?.displayName ?? 'Unknown seller'}
      </Text>
      {s?.campusEmailVerified ? <Badge kind="verified" /> : null}
      {s ? (
        <Text variant="caption" color="inkMuted">
          {`Member since ${new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(s.memberSince))}`}
        </Text>
      ) : null}
      {s?.isClosed ? (
        <Text variant="bodySm" color="danger">
          This account has been closed.
        </Text>
      ) : null}
    </SectionCard>
  );
}

export function ListingSection({ d }: { d: StaffDetail }) {
  const router = useRouter();
  const l = d.listing;
  if (!l) return null;
  return (
    <SectionCard title="Public listing">
      <Text variant="bodySm" color="inkMuted">
        The seller also has this item listed for sale on Dibbs.
      </Text>
      <Fact label="Title" value={l.title} />
      <Fact label="Listing status" value={l.status[0]!.toUpperCase() + l.status.slice(1)} />
      <Fact label="Asking price" value={formatCents(l.priceCents)} />
      {d.listingOnHoldElsewhere ? (
        <View style={styles.warn} accessibilityRole="alert">
          <Text variant="label" weight="600" color="warning">
            This listing is on hold for a meetup booked through the public listing.
          </Text>
          <Text variant="caption">You can’t confirm a Dibbs meetup for this item while that hold is in place.</Text>
        </View>
      ) : null}
      <Button
        title="Open the public listing"
        variant="secondary"
        onPress={() => router.push(`/listing/${l.id}` as never)}
        style={styles.start}
      />
    </SectionCard>
  );
}

export function FactsSection({ d }: { d: StaffDetail }) {
  const tz = d.timezone;
  const zone = zoneAbbreviation(tz);
  const est = d.estimate;
  const m = d.meetup;
  const outcome = outcomeLabel(d.closedOutcome);
  const nothing = !est && !m && !d.finalOffer && d.finalAcceptedCents == null && !d.completedAt && !outcome;
  return (
    <SectionCard title="Where it stands">
      {nothing ? (
        <Text variant="bodySm" color="inkMuted">
          No estimate has been sent yet.
        </Text>
      ) : null}
      {est ? (
        <Fact
          label={est.kind === 'exact' ? 'Estimate (exact)' : 'Estimate (range)'}
          value={`${estimateText(est.lowCents, est.highCents)}, subject to inspection`}
          note={`Sent ${formatWhen(est.sentAt)}${est.expiresAt && d.status === 'offered' ? ` · seller must answer by ${formatWhen(est.expiresAt)}` : ''}. Not a price the seller has agreed to.`}
        />
      ) : null}
      {m ? (
        <Fact
          label={m.confirmed ? 'Meetup (confirmed)' : `Meetup (proposed by ${m.proposedBy === 'seller' ? 'the seller' : 'Dibbs'})`}
          value={`${exactMeetupTime(m.startsAt, tz)}${zone ? ` ${zone}` : ''}`}
          note={m.spot ? m.spot.name : undefined}
        />
      ) : null}
      {d.finalOffer ? (
        <Fact
          label="Final offer"
          value={formatCents(d.finalOffer.cents)}
          note={`Sent ${formatWhen(d.finalOffer.sentAt)}${d.finalAcceptedCents == null && d.status === 'final_offer' ? ' · the seller has not accepted it yet' : ''}`}
        />
      ) : null}
      {d.finalAcceptedCents != null ? (
        <Fact label="Accepted price" value={formatCents(d.finalAcceptedCents)} note={`Accepted by the seller ${formatWhen(d.finalAcceptedAt)}`} />
      ) : null}
      {d.completedAt ? (
        <Fact label="Handoff" value={`Recorded complete ${formatWhen(d.completedAt)}`} note="This does not mean any payment was sent." />
      ) : null}
      {d.completedAt ? (
        <Fact
          label="Payout"
          value={d.payoutStatus === 'recorded_outside_app' ? `Recorded as made outside the app ${formatWhen(d.payoutRecordedAt)}` : 'Not recorded yet'}
          note="The payout method isn’t decided and the app moves no money."
        />
      ) : null}
      {outcome ? <Fact label="Closed as" value={outcome} /> : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { gap: space.xs, paddingTop: space.md, paddingBottom: space.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginVertical: space.xs },
  fact: { gap: 2 },
  warn: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  start: { alignSelf: 'flex-start' },
});
