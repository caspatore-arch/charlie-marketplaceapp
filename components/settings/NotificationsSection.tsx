/**
 * Notifications section of Settings: per-category on/off switches, stored
 * server-side (backend/trpc/routes/notification.ts) so they apply to sending,
 * not just to this device. Self-contained per the notifications task's file
 * ownership — see the handoff notes for the exact `app/settings.tsx` import +
 * JSX lines to drop this into the Settings screen.
 */
import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';

type Category = 'messages' | 'meetups' | 'offers';

const ROWS: { key: Category; label: string; helper: string }[] = [
  { key: 'messages', label: 'Messages', helper: 'A new message from a buyer or seller.' },
  {
    key: 'meetups',
    label: 'Meetups',
    helper: 'A request, acceptance, decline, new time proposed, or cancellation.',
  },
  {
    key: 'offers',
    label: 'Offers',
    helper: 'A new offer on your item, or an offer you made being accepted or declined.',
  },
];

export function NotificationsSection() {
  const utils = trpc.useUtils();
  const prefsQuery = trpc.notification.preferences.useQuery();
  const updateMutation = trpc.notification.updatePreferences.useMutation({
    onMutate: async (patch) => {
      await utils.notification.preferences.cancel();
      const previous = utils.notification.preferences.getData();
      if (previous) {
        utils.notification.preferences.setData(undefined, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        utils.notification.preferences.setData(undefined, context.previous);
      }
    },
    onSettled: () => {
      void utils.notification.preferences.invalidate();
    },
  });

  if (prefsQuery.isPending) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={24} />
        <Skeleton height={24} />
        <Skeleton height={24} />
      </View>
    );
  }

  if (prefsQuery.isError || !prefsQuery.data) {
    return <ErrorState message={prefsQuery.error?.message} onRetry={() => prefsQuery.refetch()} />;
  }

  const prefs = prefsQuery.data;

  return (
    <View style={styles.wrap}>
      <Text variant="body" color="inkMuted" style={styles.intro}>
        Choose what can notify you. This app never sends push notifications until you make an offer,
        send a message, or book a meetup for the first time — and only for what you leave on here.
      </Text>

      {ROWS.map((row) => (
        <View key={row.key} style={styles.row}>
          <View style={styles.rowText}>
            <Text variant="label">{row.label}</Text>
            <Text variant="caption" color="inkMuted" style={styles.helper}>
              {row.helper}
            </Text>
          </View>
          <Switch
            value={prefs[row.key]}
            onValueChange={(next) => updateMutation.mutate({ [row.key]: next })}
            trackColor={{ false: colors.line, true: colors.accent }}
            thumbColor={colors.surface}
            accessibilityLabel={`${row.label} notifications`}
            accessibilityRole="switch"
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  intro: { lineHeight: 21 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.xs,
  },
  rowText: { flex: 1, gap: 2 },
  helper: { lineHeight: 17 },
});

export default NotificationsSection;
