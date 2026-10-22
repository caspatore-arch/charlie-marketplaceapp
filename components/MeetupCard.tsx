/**
 * The signature meetup summary card, used on reservation/[id] and in the
 * Meetups & messages list. Usage:
 *
 * <MeetupCard
 *   photoUrl={reservation.listing.coverPhotoUrl}
 *   title={reservation.listing.title}
 *   priceCents={reservation.priceCents}
 *   spotName={reservation.spot?.name}
 *   spotDescription={reservation.spot?.description}
 *   customAddress={reservation.customAddress}
 *   startsAt={reservation.startsAt}
 *   timeZone={campus.timezone}
 *   status={reservation.status}
 *   directionsUrl={reservation.directionsUrl}
 *   onPressDirections={() => Linking.openURL(reservation.directionsUrl)}
 *   onReschedule={...} onCancel={...}
 * />
 *
 * Exactly one of `spotName` or `customAddress` is expected to be set — a
 * custom address renders in the spot's place (docs/AUCTIONS.md §2).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MapPin } from 'lucide-react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { PriceText } from './ui/PriceText';
import { ReservationStatusPill } from './ReservationStatusPill';
import { resolveMediaUrl } from '@/lib/trpc';
import { exactMeetupTime, zoneAbbreviation } from '@/components/booking/time';
import { DemoBadge } from './DemoBadge';
import type { ReservationStatus } from '@/types';

export interface MeetupCardProps {
  photoUrl?: string | null;
  title: string;
  priceCents: number;
  /** A curated campus spot's name. Omit when this meetup uses a custom address. */
  spotName?: string | null;
  spotDescription?: string | null;
  /** A party-proposed address, resolved server-side. Renders in place of the spot. */
  customAddress?: string | null;
  startsAt: string;
  /** Campus IANA timezone; times are always shown in campus time. */
  timeZone?: string;
  /** True when the price came from an accepted offer. */
  agreedOffer?: boolean;
  status: ReservationStatus;
  /** Optional spot extras, so the card is the one place the spot is described. */
  spotHoursNote?: string | null;
  spotIsDemo?: boolean;
  onPressDirections?: () => void;
  onReschedule?: () => void;
  onCancel?: () => void;
}

export function MeetupCard({
  photoUrl,
  title,
  priceCents,
  spotName,
  spotDescription,
  customAddress,
  startsAt,
  timeZone,
  agreedOffer,
  status,
  spotHoursNote,
  spotIsDemo,
  onPressDirections,
  onReschedule,
  onCancel,
}: MeetupCardProps) {
  const canAct = status === 'requested' || status === 'countered' || status === 'accepted';
  // Once a meetup is closed, the map placeholder and Directions are noise.
  const zone = zoneAbbreviation(timeZone, new Date(startsAt));

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Image
          source={{ uri: resolveMediaUrl(photoUrl) }}
          style={styles.thumb}
          contentFit="cover"
          transition={150}
        />
        <View style={styles.headerInfo}>
          <Text variant="heading" numberOfLines={2}>
            {title}
          </Text>
          <PriceText cents={priceCents} />
          {agreedOffer ? (
            <Text variant="caption" color="inkMuted">
              Agreed offer
            </Text>
          ) : null}
        </View>
        <ReservationStatusPill status={status} />
      </View>

      {canAct ? (
        <View style={styles.mapTile}>
          <MapPin size={22} color={colors.accent} />
          <Text variant="caption" color="inkFaint">
            Map preview unavailable in this prototype
          </Text>
        </View>
      ) : null}

      <View style={styles.spotInfo}>
        {customAddress ? (
          <>
            <Text variant="caption" color="inkFaint">
              Custom address
            </Text>
            <Text variant="label" weight="600">
              {customAddress}
            </Text>
            <Text variant="caption" color="inkMuted">
              Public places are safer for meeting someone new. Only share an address you&apos;re comfortable with.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.spotNameRow}>
              <Text variant="label" weight="600">
                {spotName}
              </Text>
              <DemoBadge visible={!!spotIsDemo} />
            </View>
            {spotDescription ? (
              <Text variant="caption" color="inkMuted">
                {spotDescription}
              </Text>
            ) : null}
            {spotHoursNote ? (
              <Text variant="caption" color="inkMuted">
                {spotHoursNote}
              </Text>
            ) : null}
          </>
        )}
        <Text variant="body" style={styles.time}>
          {exactMeetupTime(startsAt, timeZone)}
          {zone ? ` ${zone}` : ''}
        </Text>
      </View>

      <View style={styles.actions}>
        {canAct && onPressDirections ? (
          <Button title="Directions" variant="secondary" onPress={onPressDirections} style={styles.actionBtn} />
        ) : null}
        {canAct && onReschedule ? (
          <Button title="Reschedule" variant="secondary" onPress={onReschedule} style={styles.actionBtn} />
        ) : null}
        {canAct && onCancel ? (
          <Button title="Cancel" variant="ghost" onPress={onCancel} style={styles.actionBtn} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  headerInfo: { flex: 1, gap: 4 },
  mapTile: {
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  spotInfo: { gap: 2 },
  spotNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  time: { marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actionBtn: { flexGrow: 1 },
});

export default MeetupCard;
