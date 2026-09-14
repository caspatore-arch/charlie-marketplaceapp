/**
 * The signature meetup summary card, used on reservation/[id] and inline in
 * Inbox > Requests. Usage:
 *
 * <MeetupCard
 *   photoUrl={reservation.listing.coverPhotoUrl}
 *   title={reservation.listing.title}
 *   priceCents={reservation.priceCents}
 *   spotName={reservation.spot.name}
 *   spotDescription={reservation.spot.description}
 *   startsAt={reservation.startsAt}
 *   timeZone={campus.timezone}
 *   status={reservation.status}
 *   directionsUrl={reservation.directionsUrl}
 *   onPressDirections={() => Linking.openURL(reservation.directionsUrl)}
 *   onReschedule={...} onCancel={...}
 * />
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
import { formatMeetupTime } from '@/utils/format';
import type { ReservationStatus } from '@/types';

export interface MeetupCardProps {
  photoUrl?: string | null;
  title: string;
  priceCents: number;
  spotName: string;
  spotDescription: string;
  startsAt: string;
  timeZone?: string;
  status: ReservationStatus;
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
  startsAt,
  timeZone,
  status,
  onPressDirections,
  onReschedule,
  onCancel,
}: MeetupCardProps) {
  const canAct = status === 'requested' || status === 'countered' || status === 'accepted';

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
        </View>
        <ReservationStatusPill status={status} />
      </View>

      <View style={styles.mapTile}>
        <MapPin size={22} color={colors.accent} />
        <Text variant="caption" color="inkFaint">
          Map preview unavailable in this prototype
        </Text>
      </View>

      <View style={styles.spotInfo}>
        <Text variant="label" weight="600">
          {spotName}
        </Text>
        <Text variant="caption" color="inkMuted">
          {spotDescription}
        </Text>
        <Text variant="body" style={styles.time}>
          {formatMeetupTime(startsAt, timeZone)}
        </Text>
      </View>

      <View style={styles.actions}>
        {onPressDirections ? (
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
  time: { marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actionBtn: { flexGrow: 1 },
});

export default MeetupCard;
